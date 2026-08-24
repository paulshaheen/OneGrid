namespace Forwarder.Core.Options;

/// <summary>
/// Target Fabric Eventstream custom endpoint + AMQP publish tuning. Shared by all connectors.
/// </summary>
public sealed class FabricOptions
{
    public string FabricNamespaceFqdn { get; set; } = "";
    public string StreamName { get; set; } = "";
    public string TenantId { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string CertThumbprint { get; set; } = "";
    /// <summary>If set, used instead of cert auth (first-day testing only).</summary>
    public string? ConnectionString { get; set; }
    public int MaxBatchEvents { get; set; } = 1000;
    public int MaxBatchBytes { get; set; } = 256 * 1024;
    public int FlushIntervalMs { get; set; } = 50;
    public bool UseAmqpWebSockets { get; set; } = true;
}

/// <summary>Durable SQLite outbox settings. Shared by all connectors.</summary>
public sealed class QueueOptions
{
    public string Path { get; set; } = "";
    public int MaxSizeMB { get; set; } = 20480;
    public int BackpressureWarnDepth { get; set; } = 50_000;
    public int BackpressureStopDepth { get; set; } = 500_000;
}

/// <summary>Heartbeat cadence. Shared by all connectors.</summary>
public sealed class HealthOptions
{
    public int HeartbeatIntervalSeconds { get; set; } = 30;
}
