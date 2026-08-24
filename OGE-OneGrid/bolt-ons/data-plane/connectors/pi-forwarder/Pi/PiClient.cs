using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PIFabricForwarder.Models;

namespace PIFabricForwarder.Pi;

/// <summary>
/// Thin wrapper around PI Web API. Uses Windows-integrated auth via the
/// service identity (NetworkService → computer account Kerberos).
/// </summary>
public sealed class PiClient : IDisposable
{
    private readonly PiWebApiOptions _opts;
    private readonly HttpClient _http;
    private readonly ILogger<PiClient> _log;

    public PiClient(IOptions<PiWebApiOptions> opts, ILogger<PiClient> log)
    {
        _opts = opts.Value;
        _log  = log;

        var handler = new HttpClientHandler
        {
            UseDefaultCredentials = true,
            PreAuthenticate = true,
            AllowAutoRedirect = false
        };
        _http = new HttpClient(handler)
        {
            BaseAddress = new Uri(_opts.BaseUrl.TrimEnd('/') + "/"),
            Timeout = TimeSpan.FromSeconds(_opts.RequestTimeoutSeconds)
        };
        _http.DefaultRequestHeaders.Accept.Clear();
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    /// <summary>Pull current values for the given webIds via /streamsets/value.</summary>
    public async Task<JsonDocument?> GetStreamSetsValuesAsync(IEnumerable<string> webIds, CancellationToken ct)
    {
        var qs = string.Join("&", webIds.Select(id => "webId=" + Uri.EscapeDataString(id)));
        var url = $"streamsets/value?{qs}";
        using var resp = await _http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("streamsets/value HTTP {Code}", (int)resp.StatusCode);
            return null;
        }
        var stream = await resp.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }

    public HttpClient HttpClient => _http;

    public void Dispose() => _http.Dispose();
}
