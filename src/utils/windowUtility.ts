export function getCorePluginSettings(pluginId: string) {
	const plugin = window.app.internalPlugins.getPluginById(pluginId);
	if (plugin?.enabled) {
		return plugin.instance?.options;
	}
	return undefined;
}
