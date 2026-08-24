using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using DbForwarder.Models;

namespace DbForwarder;

/// <summary>
/// Loads sources.json at startup and exposes the resolved source definitions.
/// Analog of the PI connector's TagRegistry. (Hot reload requires a restart.)
/// </summary>
public sealed class SourceRegistry
{
    public IReadOnlyList<SourceDefinition> All { get; }

    public SourceRegistry(IOptions<DbForwarderOptions> opts, ILogger<SourceRegistry> log)
    {
        var path = opts.Value.SourcesConfigPath;
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            log.LogWarning("Sources config not found at {Path}; starting with empty source set.", path);
            All = Array.Empty<SourceDefinition>();
            return;
        }

        var json = File.ReadAllBytes(path);
        var sources = JsonSerializer.Deserialize<List<SourceDefinition>>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? new List<SourceDefinition>();

        // Validate + de-dup by name.
        var valid = new List<SourceDefinition>();
        foreach (var s in sources)
        {
            if (string.IsNullOrWhiteSpace(s.Name)) { log.LogWarning("Skipping a source with no name."); continue; }
            if (string.IsNullOrWhiteSpace(s.Query)) { log.LogWarning("Source {Name} has no query; skipping.", s.Name); continue; }
            if (string.IsNullOrWhiteSpace(s.WatermarkColumn)) { log.LogWarning("Source {Name} has no watermarkColumn; skipping.", s.Name); continue; }
            valid.Add(s);
        }

        All = valid
            .GroupBy(s => s.Name)
            .Select(g => g.First())
            .ToList();

        log.LogInformation("Loaded {Count} source(s) from {Path} ({Sql} SqlServer, {Ora} Oracle)",
            All.Count, path,
            All.Count(s => s.Provider == DbProvider.SqlServer),
            All.Count(s => s.Provider == DbProvider.Oracle));
    }
}
