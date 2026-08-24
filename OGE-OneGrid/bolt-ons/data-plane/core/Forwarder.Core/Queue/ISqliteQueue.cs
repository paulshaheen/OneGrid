using Forwarder.Core.Models;

namespace Forwarder.Core.Queue;

public interface ISqliteQueue
{
    Task EnqueueBatchAsync(IReadOnlyList<QueuedEvent> events, CancellationToken ct);
    Task<IReadOnlyList<QueuedEvent>> PeekBatchAsync(int max, int maxBytes, CancellationToken ct);
    Task<int> DeleteAckedAsync(IEnumerable<long> rowIds, CancellationToken ct);
    Task<long> DepthAsync(CancellationToken ct);
    Task<long> SizeBytesAsync(CancellationToken ct);
}
