namespace Forwarder.Core;

/// <summary>
/// Lightweight in-memory metrics shared across loops. A future enhancement is to
/// surface these via Windows Performance Counters and OpenTelemetry; for now the
/// HealthLoop publishes them as part of each heartbeat.
/// </summary>
public sealed class Metrics
{
    private long _publishedTotal;
    private long _publishFailuresTotal;
    private long _publishedRecent;
    private DateTimeOffset _recentWindowStart = DateTimeOffset.UtcNow;

    public long QueueDepth { get; set; }
    public long QueueBytes { get; set; }
    public long PublishedTotal => Interlocked.Read(ref _publishedTotal);
    public long PublishFailuresTotal => Interlocked.Read(ref _publishFailuresTotal);

    public double RecentPublishRate
    {
        get
        {
            var now = DateTimeOffset.UtcNow;
            var elapsed = (now - _recentWindowStart).TotalSeconds;
            if (elapsed < 1) return 0;
            var count = Interlocked.Read(ref _publishedRecent);
            // Roll the window.
            Interlocked.Exchange(ref _publishedRecent, 0);
            _recentWindowStart = now;
            return count / elapsed;
        }
    }

    public void RecordPublished(int count)
    {
        Interlocked.Add(ref _publishedTotal, count);
        Interlocked.Add(ref _publishedRecent, count);
    }

    public void RecordPublishFailure() => Interlocked.Increment(ref _publishFailuresTotal);
}
