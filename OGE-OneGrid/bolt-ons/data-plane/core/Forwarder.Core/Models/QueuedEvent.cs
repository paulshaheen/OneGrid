namespace Forwarder.Core.Models;

/// <summary>
/// One enqueued event waiting to be published. Stored as a row in the SQLite
/// queue. <see cref="RowId"/> is set after enqueue and used to ack/delete on
/// successful publish.
/// </summary>
public sealed class QueuedEvent
{
    public long RowId { get; init; }
    public DateTimeOffset EnqueuedTs { get; init; }
    public string WebId { get; init; } = "";
    public string Plant { get; init; } = "";
    /// <summary>UTF-8 JSON payload that will be sent as the EventData body.</summary>
    public byte[] PayloadJsonUtf8 { get; init; } = Array.Empty<byte>();
}
