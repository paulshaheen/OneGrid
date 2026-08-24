using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PIFabricForwarder.Models;
using PIFabricForwarder.Pi;
using Forwarder.Core.Health;
using Forwarder.Core.Queue;

namespace PIFabricForwarder.Loops;

/// <summary>
/// Owns N <see cref="PiChannelSubscriber"/> instances — one per channel group of
/// up to <see cref="PiWebApiOptions.ChannelGroupSize"/> webIds.
/// Each subscriber runs independently with its own reconnect/backoff loop.
/// </summary>
public sealed class HotPathLoop : BackgroundService, ISourceHealth
{
    private readonly TagRegistry _tags;
    private readonly ISqliteQueue _queue;
    private readonly PiWebApiOptions _piOpts;
    private readonly ILoggerFactory _logFactory;
    private readonly ILogger<HotPathLoop> _log;

    private readonly List<PiChannelSubscriber> _subscribers = new();

    public HotPathLoop(
        TagRegistry tags,
        ISqliteQueue queue,
        IOptions<PiWebApiOptions> piOpts,
        ILoggerFactory logFactory)
    {
        _tags       = tags;
        _queue      = queue;
        _piOpts     = piOpts.Value;
        _logFactory = logFactory;
        _log        = logFactory.CreateLogger<HotPathLoop>();
    }

    public int ActiveChannelCount => _subscribers.Count(s => s.IsConnected);

    /// <summary><see cref="ISourceHealth"/> — surfaced in the heartbeat.</summary>
    public int ActiveSourceCount => ActiveChannelCount;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var channelTags = _tags.All.Where(t => t.Mode == TagMode.Channel).ToList();
        if (channelTags.Count == 0)
        {
            _log.LogInformation("No tags in Channel mode; HotPathLoop idle.");
            await Task.Delay(Timeout.Infinite, ct).ContinueWith(_ => { });
            return;
        }

        var groups = ChunkBy(channelTags, _piOpts.ChannelGroupSize).ToList();
        _log.LogInformation("Starting HotPathLoop: {Tags} channel tags in {Groups} group(s) of up to {Size}",
            channelTags.Count, groups.Count, _piOpts.ChannelGroupSize);

        var tasks = new List<Task>();
        for (var i = 0; i < groups.Count; i++)
        {
            var group = groups[i];
            var groupId = $"g{i:D3}";
            var uri = BuildChannelUri(group);
            var sub = new PiChannelSubscriber(
                groupId, uri, group, _queue,
                _logFactory.CreateLogger($"PiChannel.{groupId}"));
            _subscribers.Add(sub);
            tasks.Add(sub.RunAsync(ct));
        }

        try { await Task.WhenAll(tasks); }
        catch (OperationCanceledException) { /* shutdown */ }
    }

    private Uri BuildChannelUri(IReadOnlyList<PiTagConfig> group)
    {
        // PI Web API multi-stream channel:
        //   wss://.../piwebapi/streamsets/channel?webId=...&webId=...
        var baseUri = _piOpts.BaseUrl.TrimEnd('/');
        var wsBase = baseUri
            .Replace("https://", "wss://", StringComparison.OrdinalIgnoreCase)
            .Replace("http://",  "ws://",  StringComparison.OrdinalIgnoreCase);
        var qs = string.Join("&", group.Select(t => "webId=" + Uri.EscapeDataString(t.WebId)));
        return new Uri($"{wsBase}/streamsets/channel?{qs}&includeInitialValues=true");
    }

    private static IEnumerable<List<T>> ChunkBy<T>(IReadOnlyList<T> source, int size)
    {
        for (var i = 0; i < source.Count; i += size)
            yield return source.Skip(i).Take(size).ToList();
    }
}
