namespace Forwarder.Core.Health;

/// <summary>
/// Source-liveness signal surfaced in the forwarder heartbeat. Each connector's
/// read loop implements this so <c>HealthLoop</c> stays source-agnostic:
/// PI reports its active WebSocket channel count; the db-forwarder reports the
/// number of healthy source connections (0 or 1 per source).
/// </summary>
public interface ISourceHealth
{
    int ActiveSourceCount { get; }
}
