using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PIFabricForwarder.Models;
using PIFabricForwarder.Pi;

namespace PIFabricForwarder.Loops;

/// <summary>
/// Polls /streamsets/value for the Poll-mode tags every PollIntervalSeconds.
/// </summary>
public sealed class PollPathLoop : BackgroundService
{
    private readonly TagRegistry _tags;
    private readonly PiStreamSetsPoller _poller;
    private readonly PiWebApiOptions _opts;
    private readonly ILogger<PollPathLoop> _log;

    public PollPathLoop(
        TagRegistry tags,
        PiStreamSetsPoller poller,
        IOptions<PiWebApiOptions> opts,
        ILogger<PollPathLoop> log)
    {
        _tags = tags;
        _poller = poller;
        _opts = opts.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var pollTags = _tags.All.Where(t => t.Mode == TagMode.Poll).ToList();
        if (pollTags.Count == 0)
        {
            _log.LogInformation("No tags in Poll mode; PollPathLoop idle.");
            return;
        }

        _log.LogInformation("Starting PollPathLoop: {Tags} tags @ {Interval}s",
            pollTags.Count, _opts.PollIntervalSeconds);

        var period = TimeSpan.FromSeconds(_opts.PollIntervalSeconds);
        while (!ct.IsCancellationRequested)
        {
            try { await _poller.PollOnceAsync(pollTags, ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex) { _log.LogWarning(ex, "Poll iteration failed"); }

            try { await Task.Delay(period, ct); }
            catch (OperationCanceledException) { break; }
        }
    }
}
