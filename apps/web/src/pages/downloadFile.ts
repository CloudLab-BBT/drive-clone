export async function download(file: { id: string; name: string }) {
  const response = await fetch(`/api/v1/files/${file.id}/download`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/octet-stream' },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(error?.message ?? 'No se pudo descargar el archivo');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
