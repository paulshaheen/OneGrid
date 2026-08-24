namespace PIFabricForwarder.Models;

/// <summary>PI Web API read settings (source-specific to this connector).</summary>
public sealed class PiWebApiOptions
{
    public string BaseUrl { get; set; } = "";
    public string DataServer { get; set; } = "";
    public int PollIntervalSeconds { get; set; } = 5;
    public int ChannelGroupSize { get; set; } = 250;
    public int RequestTimeoutSeconds { get; set; } = 60;
    public int MaxConcurrentChannels { get; set; } = 8;
}

/// <summary>Path to tags.json (source-specific to this connector).</summary>
public sealed class TagsOptions
{
    public string ConfigPath { get; set; } = "";
}
