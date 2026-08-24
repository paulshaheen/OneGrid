using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Hosting.WindowsServices;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using PIFabricForwarder;
using PIFabricForwarder.Loops;
using PIFabricForwarder.Models;
using PIFabricForwarder.Pi;
using Forwarder.Core;
using Forwarder.Core.Health;
using Forwarder.Core.Loops;
using Forwarder.Core.Options;
using Forwarder.Core.Publish;
using Forwarder.Core.Queue;

var builder = Host.CreateApplicationBuilder(args);

// Run as Windows Service when launched by SCM; otherwise run as a console.
builder.Services.AddWindowsService(opts => opts.ServiceName = "PIFabricForwarder");

// Logging — Event Log on Windows + Console for interactive runs.
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o =>
{
    o.SingleLine = true;
    o.TimestampFormat = "HH:mm:ss.fff ";
});
if (OperatingSystem.IsWindows())
{
#pragma warning disable CA1416 // Guarded by OperatingSystem.IsWindows above
    builder.Logging.AddEventLog(o =>
    {
        o.SourceName = "PIFabricForwarder";
    });
#pragma warning restore CA1416
}

// Options
builder.Services.Configure<PiWebApiOptions>(builder.Configuration.GetSection("PiWebApi"));
builder.Services.Configure<FabricOptions>(builder.Configuration.GetSection("Fabric"));
builder.Services.Configure<QueueOptions>(builder.Configuration.GetSection("Queue"));
builder.Services.Configure<TagsOptions>(builder.Configuration.GetSection("Tags"));
builder.Services.Configure<HealthOptions>(builder.Configuration.GetSection("Health"));

// Singletons
builder.Services.AddSingleton<Metrics>();
builder.Services.AddSingleton<TagRegistry>();
builder.Services.AddSingleton<ISqliteQueue, SqliteQueue>();
builder.Services.AddSingleton<PiClient>();
builder.Services.AddSingleton<PiStreamSetsPoller>();
builder.Services.AddSingleton<FabricPublisher>();

// HotPathLoop is registered both as a singleton (so HealthLoop can read its
// IsConnected metric) and as a hosted service. It also provides ISourceHealth.
builder.Services.AddSingleton<HotPathLoop>();
builder.Services.AddSingleton<ISourceHealth>(sp => sp.GetRequiredService<HotPathLoop>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<HotPathLoop>());

builder.Services.AddHostedService<PollPathLoop>();
builder.Services.AddHostedService<PublisherLoop>();
builder.Services.AddHostedService<HealthLoop>();

var host = builder.Build();

// Eager-load TagRegistry so config errors surface at startup, not on first event.
_ = host.Services.GetRequiredService<TagRegistry>();
_ = host.Services.GetRequiredService<ISqliteQueue>();

await host.RunAsync();
