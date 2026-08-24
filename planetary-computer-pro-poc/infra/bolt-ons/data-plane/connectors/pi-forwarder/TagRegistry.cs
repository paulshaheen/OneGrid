using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PIFabricForwarder.Models;

namespace PIFabricForwarder;

/// <summary>
/// Loads the tags.json file at startup and exposes the resolved set of tag
/// configurations to the loops. (Hot reload is a future enhancement; for now,
/// service restart is required to pick up changes.)
/// </summary>
public sealed class TagRegistry
{
    public IReadOnlyList<PiTagConfig> All { get; }

    public TagRegistry(IOptions<TagsOptions> opts, ILogger<TagRegistry> log)
    {
        var path = opts.Value.ConfigPath;
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            log.LogWarning("Tag config not found at {Path}; starting with empty tag set.", path);
            All = Array.Empty<PiTagConfig>();
            return;
        }

        var json = File.ReadAllBytes(path);
        var tags = JsonSerializer.Deserialize<List<PiTagConfig>>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? new List<PiTagConfig>();

        // De-dup by webId in case the bootstrap script produces duplicates.
        All = tags
            .Where(t => !string.IsNullOrWhiteSpace(t.WebId))
            .GroupBy(t => t.WebId)
            .Select(g => g.First())
            .ToList();

        log.LogInformation("Loaded {Count} tags from {Path} ({Channel} Channel, {Poll} Poll, {Skip} Skip)",
            All.Count, path,
            All.Count(t => t.Mode == TagMode.Channel),
            All.Count(t => t.Mode == TagMode.Poll),
            All.Count(t => t.Mode == TagMode.Skip));
    }
}
