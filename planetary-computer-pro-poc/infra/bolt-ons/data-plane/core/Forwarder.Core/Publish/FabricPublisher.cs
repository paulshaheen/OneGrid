using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Azure.Identity;
using Azure.Messaging.EventHubs;
using Azure.Messaging.EventHubs.Producer;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Forwarder.Core.Options;
using Forwarder.Core.Queue;

namespace Forwarder.Core.Publish;

/// <summary>
/// Wraps EventHubProducerClient to publish to Fabric Eventstream Custom Endpoint.
/// AMQP 1.0 (over WebSockets if configured) with cert-based Entra auth, or a
/// connection string for first-day testing.
/// </summary>
public sealed class FabricPublisher : IAsyncDisposable
{
    private readonly FabricOptions _opts;
    private readonly ILogger<FabricPublisher> _log;
    private readonly EventHubProducerClient _producer;

    public FabricPublisher(IOptions<FabricOptions> opts, ILogger<FabricPublisher> log)
    {
        _opts = opts.Value;
        _log  = log;

        var clientOpts = new EventHubProducerClientOptions
        {
            ConnectionOptions = new EventHubConnectionOptions
            {
                TransportType = _opts.UseAmqpWebSockets
                    ? EventHubsTransportType.AmqpWebSockets
                    : EventHubsTransportType.AmqpTcp
            }
        };

        if (!string.IsNullOrWhiteSpace(_opts.ConnectionString))
        {
            _log.LogWarning("Using connection-string auth (testing only). Switch to cert auth before production.");
            _producer = new EventHubProducerClient(_opts.ConnectionString, _opts.StreamName, clientOpts);
        }
        else
        {
            var cert = LoadCertFromStore(_opts.CertThumbprint);
            var credential = new ClientCertificateCredential(_opts.TenantId, _opts.ClientId, cert);
            _producer = new EventHubProducerClient(
                _opts.FabricNamespaceFqdn, _opts.StreamName, credential, clientOpts);
        }
    }

    /// <summary>
    /// Sends a batch atomically. Returns true on success; throws on broker error
    /// so the caller can leave the batch in the queue and retry.
    /// </summary>
    public async Task SendBatchAsync(IReadOnlyList<QueuedEventBatchItem> items, CancellationToken ct)
    {
        if (items.Count == 0) return;

        using var batch = await _producer.CreateBatchAsync(new CreateBatchOptions
        {
            MaximumSizeInBytes = _opts.MaxBatchBytes
        }, ct);

        foreach (var item in items)
        {
            var data = new EventData(item.PayloadJsonUtf8)
            {
                ContentType = "application/json",
                MessageId = item.RowId.ToString()
            };
            data.Properties["webId"] = item.WebId;
            data.Properties["plant"] = item.Plant;

            if (!batch.TryAdd(data))
            {
                if (batch.Count == 0)
                    throw new InvalidOperationException(
                        $"Single event of {item.PayloadJsonUtf8.Length} bytes exceeds MaxBatchBytes ({_opts.MaxBatchBytes}).");
                break;
            }
        }

        await _producer.SendAsync(batch, ct);
    }

    /// <summary>
    /// Send a single ad-hoc event (used for heartbeats — bypasses the queue).
    /// </summary>
    public async Task SendAdHocAsync(string tag, object payload, CancellationToken ct)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        var data = new EventData(bytes) { ContentType = "application/json" };
        data.Properties["tag"] = tag;
        data.Properties["host"] = Environment.MachineName;

        using var batch = await _producer.CreateBatchAsync(ct);
        batch.TryAdd(data);
        await _producer.SendAsync(batch, ct);
    }

    private static X509Certificate2 LoadCertFromStore(string thumbprint)
    {
        if (string.IsNullOrWhiteSpace(thumbprint))
            throw new InvalidOperationException("Fabric:CertThumbprint is required when ConnectionString is empty.");

        // Search LocalMachine\My first (service account scenario), then CurrentUser\My (dev).
        foreach (var location in new[] { StoreLocation.LocalMachine, StoreLocation.CurrentUser })
        {
            using var store = new X509Store(StoreName.My, location);
            store.Open(OpenFlags.ReadOnly);
            var match = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint, validOnly: false);
            if (match.Count > 0) return match[0];
        }
        throw new InvalidOperationException(
            $"Certificate with thumbprint '{thumbprint}' not found in LocalMachine\\My or CurrentUser\\My.");
    }

    public async ValueTask DisposeAsync() => await _producer.DisposeAsync();
}
