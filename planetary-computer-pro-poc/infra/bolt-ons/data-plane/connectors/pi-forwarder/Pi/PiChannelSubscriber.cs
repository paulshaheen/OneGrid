using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using PIFabricForwarder.Models;
using Forwarder.Core.Models;
using Forwarder.Core.Queue;

namespace PIFabricForwarder.Pi;

/// <summary>
/// One <see cref="PiChannelSubscriber"/> instance owns a single PI Web API
/// /streams/.../channel WebSocket carrying up to N webIds. Reconnects with
/// exponential backoff on disconnect.
/// </summary>
public sealed class PiChannelSubscriber
{
    private readonly Uri _channelUri;
    private readonly IReadOnlyList<PiTagConfig> _tags;
    private readonly Dictionary<string, PiTagConfig> _byWebId;
    private readonly ISqliteQueue _queue;
    private readonly ILogger _log;

    public string GroupId { get; }
    public bool IsConnected { get; private set; }

    public PiChannelSubscriber(
        string groupId,
        Uri channelUri,
        IReadOnlyList<PiTagConfig> tags,
        ISqliteQueue queue,
        ILogger log)
    {
        GroupId      = groupId;
        _channelUri  = channelUri;
        _tags        = tags;
        _byWebId     = tags.ToDictionary(t => t.WebId);
        _queue       = queue;
        _log         = log;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        var backoffMs = 1_000;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var ws = new ClientWebSocket();
                ws.Options.UseDefaultCredentials = true;
                ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(30);

                _log.LogInformation("[Channel {Group}] Connecting to {Uri}", GroupId, _channelUri);
                await ws.ConnectAsync(_channelUri, ct);
                IsConnected = true;
                backoffMs = 1_000; // reset on success
                _log.LogInformation("[Channel {Group}] Connected ({TagCount} tags)", GroupId, _tags.Count);

                await ReceiveLoopAsync(ws, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                IsConnected = false;
                _log.LogWarning(ex, "[Channel {Group}] Disconnected; reconnecting in {Ms} ms", GroupId, backoffMs);
                try { await Task.Delay(backoffMs, ct); }
                catch (OperationCanceledException) { break; }
                backoffMs = Math.Min(backoffMs * 2, 60_000);
            }
        }
        IsConnected = false;
    }

    private async Task ReceiveLoopAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        var assembler = new MemoryStream();

        while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            assembler.SetLength(0);
            WebSocketReceiveResult result;
            do
            {
                result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "client closed", ct);
                    return;
                }
                assembler.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            if (assembler.Length == 0) continue;

            var events = ParseChannelMessage(assembler.GetBuffer().AsSpan(0, (int)assembler.Length));
            if (events.Count > 0)
                await _queue.EnqueueBatchAsync(events, ct);
        }
    }

    /// <summary>
    /// Channel message envelope (PI Web API):
    /// {
    ///   "Items": [
    ///     { "WebId": "...", "Items": [ { "Timestamp": "...", "Value": ..., "Good": true, ... }, ... ] },
    ///     ...
    ///   ]
    /// }
    /// </summary>
    private List<QueuedEvent> ParseChannelMessage(ReadOnlySpan<byte> payload)
    {
        var batch = new List<QueuedEvent>();
        try
        {
            using var doc = JsonDocument.Parse(payload.ToArray());
            if (!doc.RootElement.TryGetProperty("Items", out var streams)) return batch;

            foreach (var stream in streams.EnumerateArray())
            {
                if (!stream.TryGetProperty("WebId", out var webIdEl)) continue;
                var webId = webIdEl.GetString();
                if (webId is null || !_byWebId.TryGetValue(webId, out var cfg)) continue;

                if (!stream.TryGetProperty("Items", out var values)) continue;
                foreach (var v in values.EnumerateArray())
                {
                    var evt = new SourceEvent
                    {
                        WebId        = webId,
                        Tag          = cfg.Tag,
                        Plant        = cfg.Plant,
                        Source       = "channel",
                        Ts           = v.TryGetProperty("Timestamp", out var tsEl) && tsEl.TryGetDateTimeOffset(out var ts)
                                           ? ts : DateTimeOffset.UtcNow,
                        Value        = v.TryGetProperty("Value", out var valEl) ? UnboxJsonValue(valEl) : null,
                        Questionable = v.TryGetProperty("Questionable", out var q) && q.ValueKind == JsonValueKind.True,
                        Substituted  = v.TryGetProperty("Substituted",  out var s) && s.ValueKind == JsonValueKind.True,
                        ValueType    = v.TryGetProperty("UnitsAbbreviation", out var u) ? u.GetString() : null
                    };
                    batch.Add(new QueuedEvent
                    {
                        EnqueuedTs      = DateTimeOffset.UtcNow,
                        WebId           = webId,
                        Plant           = cfg.Plant,
                        PayloadJsonUtf8 = JsonSerializer.SerializeToUtf8Bytes(evt)
                    });
                }
            }
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "[Channel {Group}] Failed to parse message ({Bytes} bytes)", GroupId, payload.Length);
        }
        return batch;
    }

    private static object? UnboxJsonValue(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Number => el.TryGetDouble(out var d) ? d : (object)el.GetRawText(),
        JsonValueKind.String => el.GetString(),
        JsonValueKind.True   => true,
        JsonValueKind.False  => false,
        JsonValueKind.Null   => null,
        JsonValueKind.Object => el.GetRawText(),  // digital states / nested
        _ => el.GetRawText()
    };
}
