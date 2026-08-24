using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PIFabricForwarder.Models;
using Forwarder.Core.Models;
using Forwarder.Core.Queue;

namespace PIFabricForwarder.Pi;

/// <summary>
/// Polls /streamsets/value for the set of tags that are configured as Poll mode.
/// </summary>
public sealed class PiStreamSetsPoller
{
    private readonly PiClient _pi;
    private readonly ISqliteQueue _queue;
    private readonly PiWebApiOptions _opts;
    private readonly ILogger<PiStreamSetsPoller> _log;

    public PiStreamSetsPoller(
        PiClient pi,
        ISqliteQueue queue,
        IOptions<PiWebApiOptions> opts,
        ILogger<PiStreamSetsPoller> log)
    {
        _pi = pi;
        _queue = queue;
        _opts = opts.Value;
        _log = log;
    }

    public async Task PollOnceAsync(IReadOnlyList<PiTagConfig> tags, CancellationToken ct)
    {
        if (tags.Count == 0) return;

        var byWebId = tags.ToDictionary(t => t.WebId);
        // Batch up to 1000 webIds per call (PI Web API safe default).
        const int batchSize = 1000;
        for (var i = 0; i < tags.Count; i += batchSize)
        {
            var slice = tags.Skip(i).Take(batchSize).ToList();
            var doc = await _pi.GetStreamSetsValuesAsync(slice.Select(t => t.WebId), ct);
            if (doc is null) continue;

            var events = new List<QueuedEvent>(slice.Count);
            try
            {
                if (!doc.RootElement.TryGetProperty("Items", out var items)) continue;
                foreach (var stream in items.EnumerateArray())
                {
                    if (!stream.TryGetProperty("WebId", out var webIdEl)) continue;
                    var webId = webIdEl.GetString();
                    if (webId is null || !byWebId.TryGetValue(webId, out var cfg)) continue;
                    if (!stream.TryGetProperty("Value", out var v)) continue;

                    var evt = new SourceEvent
                    {
                        WebId        = webId,
                        Tag          = cfg.Tag,
                        Plant        = cfg.Plant,
                        Source       = "poll",
                        Ts           = v.TryGetProperty("Timestamp", out var tsEl) && tsEl.TryGetDateTimeOffset(out var ts)
                                           ? ts : DateTimeOffset.UtcNow,
                        Value        = v.TryGetProperty("Value", out var valEl) ? UnboxJsonValue(valEl) : null,
                        Questionable = v.TryGetProperty("Questionable", out var q) && q.ValueKind == JsonValueKind.True,
                        Substituted  = v.TryGetProperty("Substituted",  out var s) && s.ValueKind == JsonValueKind.True,
                        ValueType    = v.TryGetProperty("UnitsAbbreviation", out var u) ? u.GetString() : null
                    };
                    events.Add(new QueuedEvent
                    {
                        EnqueuedTs      = DateTimeOffset.UtcNow,
                        WebId           = webId,
                        Plant           = cfg.Plant,
                        PayloadJsonUtf8 = JsonSerializer.SerializeToUtf8Bytes(evt)
                    });
                }
            }
            finally { doc.Dispose(); }

            if (events.Count > 0)
                await _queue.EnqueueBatchAsync(events, ct);
        }
    }

    private static object? UnboxJsonValue(JsonElement el) => el.ValueKind switch
    {
        JsonValueKind.Number => el.TryGetDouble(out var d) ? d : (object)el.GetRawText(),
        JsonValueKind.String => el.GetString(),
        JsonValueKind.True   => true,
        JsonValueKind.False  => false,
        JsonValueKind.Null   => null,
        JsonValueKind.Object => el.GetRawText(),
        _ => el.GetRawText()
    };
}
