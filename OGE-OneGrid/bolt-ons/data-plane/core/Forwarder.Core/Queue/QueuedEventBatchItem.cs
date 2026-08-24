namespace Forwarder.Core.Queue;

/// <summary>
/// Lightweight projection of <see cref="Models.QueuedEvent"/> for the publisher path.
/// Lets the publisher work without taking a dependency on the SQLite-bound model.
/// </summary>
public sealed record QueuedEventBatchItem(long RowId, string WebId, string Plant, byte[] PayloadJsonUtf8);
