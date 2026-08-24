using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Forwarder.Core.Options;
using Forwarder.Core.Publish;
using Forwarder.Core.Queue;

namespace Forwarder.Core.Loops;

/// <summary>
/// Drains the SQLite queue into Fabric Eventstream Custom Endpoint.
/// Delete-after-ack: rows are removed from SQLite only after the broker confirms.
/// Source-agnostic — shared by every connector.
/// </summary>
public sealed class PublisherLoop : BackgroundService
{
    private readonly ISqliteQueue _queue;
    private readonly FabricPublisher _publisher;
    private readonly Metrics _metrics;
    private readonly FabricOptions _opts;
    private readonly ILogger<PublisherLoop> _log;

    public PublisherLoop(
        ISqliteQueue queue,
        FabricPublisher publisher,
        Metrics metrics,
        IOptions<FabricOptions> opts,
        ILogger<PublisherLoop> log)
    {
        _queue = queue;
        _publisher = publisher;
        _metrics = metrics;
        _opts = opts.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        _log.LogInformation("PublisherLoop started; targeting {Stream} on {Fqdn}",
            _opts.StreamName,
            string.IsNullOrEmpty(_opts.ConnectionString) ? _opts.FabricNamespaceFqdn : "<connection-string>");

        var idleDelay = TimeSpan.FromMilliseconds(_opts.FlushIntervalMs);
        var backoffMs = 500;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var batch = await _queue.PeekBatchAsync(_opts.MaxBatchEvents, _opts.MaxBatchBytes, ct);
                if (batch.Count == 0)
                {
                    try { await Task.Delay(idleDelay, ct); }
                    catch (OperationCanceledException) { break; }
                    continue;
                }

                var items = batch
                    .Select(e => new QueuedEventBatchItem(e.RowId, e.WebId, e.Plant, e.PayloadJsonUtf8))
                    .ToList();

                await _publisher.SendBatchAsync(items, ct);
                var deleted = await _queue.DeleteAckedAsync(batch.Select(b => b.RowId), ct);

                _metrics.RecordPublished(deleted);
                backoffMs = 500;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _metrics.RecordPublishFailure();
                _log.LogError(ex, "Publish failed; backing off {Ms} ms", backoffMs);
                try { await Task.Delay(backoffMs, ct); }
                catch (OperationCanceledException) { break; }
                backoffMs = Math.Min(backoffMs * 2, 30_000);
            }
        }

        _log.LogInformation("PublisherLoop stopped");
    }
}
