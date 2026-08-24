using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Forwarder.Core.Health;
using Forwarder.Core.Options;
using Forwarder.Core.Publish;
using Forwarder.Core.Queue;

namespace Forwarder.Core.Loops;

/// <summary>
/// Periodically emits a heartbeat event to Fabric and updates in-memory metrics
/// (read by the <see cref="Metrics"/> singleton). The heartbeat doubles as a
/// liveness signal for a Reflex rule on the Fabric side. Source-agnostic: reads
/// source liveness through <see cref="ISourceHealth"/>, so any connector can reuse it.
/// </summary>
public sealed class HealthLoop : BackgroundService
{
    private readonly ISqliteQueue _queue;
    private readonly FabricPublisher _publisher;
    private readonly ISourceHealth _health;
    private readonly Metrics _metrics;
    private readonly HealthOptions _opts;
    private readonly ILogger<HealthLoop> _log;

    public HealthLoop(
        ISqliteQueue queue,
        FabricPublisher publisher,
        ISourceHealth health,
        Metrics metrics,
        IOptions<HealthOptions> opts,
        ILogger<HealthLoop> log)
    {
        _queue = queue;
        _publisher = publisher;
        _health = health;
        _metrics = metrics;
        _opts = opts.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var period = TimeSpan.FromSeconds(_opts.HeartbeatIntervalSeconds);
        // Small initial delay so the publisher comes up first.
        try { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
        catch (OperationCanceledException) { return; }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var depth = await _queue.DepthAsync(ct);
                var bytes = await _queue.SizeBytesAsync(ct);
                _metrics.QueueDepth = depth;
                _metrics.QueueBytes = bytes;

                var hb = new
                {
                    tag = "forwarder.heartbeat",
                    host = Environment.MachineName,
                    ts = DateTimeOffset.UtcNow,
                    queue_depth = depth,
                    queue_bytes = bytes,
                    active_channels = _health.ActiveSourceCount,
                    publish_rate_per_sec = _metrics.RecentPublishRate,
                    publish_failures_total = _metrics.PublishFailuresTotal
                };
                await _publisher.SendAdHocAsync("forwarder.heartbeat", hb, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Heartbeat publish failed");
            }

            try { await Task.Delay(period, ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
