type SurfaceHost = { openSurface(surfaceId: string): Promise<void> };

/** Both global tools open their single existing rail panel, regardless of chat scope. */
export async function openManager(host: SurfaceHost, panel: { id: string; name: string }): Promise<void> {
  try {
    await host.openSurface(`plugin:${panel.id}`);
  } catch {
    throw new Error(`未能打开「${panel.name}」。请重新加载界面后重试。`);
  }
}
