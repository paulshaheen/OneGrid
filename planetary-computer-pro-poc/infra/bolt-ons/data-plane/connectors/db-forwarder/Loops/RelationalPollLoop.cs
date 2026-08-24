using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Forwarder.Core.Health;
using DbForwarder.Db;
using DbForwarder.Models;

namespace DbForwarder.Loops;

/// <summary>
/// Drives one independent poll task per configured source, each on its own interval.
/// Implements <see cref="ISourceHealth"/> — reports how many sources polled
/// successfully within their last expected window (surfaced in the heartbeat).
/// </summary>
public sealed class RelationalPollLoop : BackgroundService, ISourceHealth
{
    private readonly SourceRegistry _sources;
    private readonly RelationalPoller _poller;
    private readonly ILogger<RelationalPollLoop> _log;

    private readonly Dictionary<string, DateTimeOffset> _lastOk = new();
    private readonly Dictionary<string, int> _intervalSec = new();
    private readonly object _healthLock = new();

    public RelationalPollLoop(SourceRegistry sources, RelationalPoller poller, ILogger<RelationalPollLoop> log)
    {
        _sources = sources;
        _poller = poller;
        _log = log;
    }

    /// <summary>Sources whose last successful poll is within ~3× their interval.</summary>
    public int ActiveSourceCount
    {
        get
        {
            lock (_healthLock)
            {
                var now = DateTimeOffset.UtcNow;
                var count = 0;
                foreach (var kv in _lastOk)
                {
                    var interval = _intervalSec.TryGetValue(kv.Key, out var i) ? i : 15;
                    if ((now - kv.Value).TotalSeconds <= interval * 3 + 10) count++;
                }
                return count;
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var sources = _sources.All;
        if (sources.Count == 0)
        {
            _log.LogWarning("No sources configured; RelationalPollLoop idle.");
            return;
        }

        _log.LogInformation("Starting RelationalPollLoop for {Count} source(s)", sources.Count);
        var tasks = sources.Select(s => RunSourceAsync(s, ct)).ToList();
        try { await Task.WhenAll(tasks); }
        catch (OperationCanceledException) { /* shutdown */ }
    }

    private async Task RunSourceAsync(SourceDefinition s, CancellationToken ct)
    {
        lock (_healthLock) { _intervalSec[s.Name] = s.PollIntervalSeconds; }
        var period = TimeSpan.FromSeconds(Math.Max(1, s.PollIntervalSeconds));

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await _poller.PollOnceAsync(s, ct);
                lock (_healthLock) { _lastOk[s.Name] = DateTimeOffset.UtcNow; }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "[{Source}] poll failed", s.Name);
            }

            try { await Task.Delay(period, ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
