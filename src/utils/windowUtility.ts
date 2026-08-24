interface CorePluginSettings {
	options?: unknown;
}

interface InternalPlugins {
	getPluginById(pluginId: string):
		| (CorePluginSettings & { enabled?: boolean; instance?: CorePluginSettings })
		| undefined;
}

interface ObsidianWindow {
	app: { internalPlugins: InternalPlugins };
}

export function getCorePluginSettings(pluginId: string): unknown {
	const plugin = (window as unknown as ObsidianWindow).app.internalPlugins.getPluginById(
		pluginId,
	);
	if (plugin?.enabled) {
		return plugin.instance?.options;
	}
	return undefined;
}
