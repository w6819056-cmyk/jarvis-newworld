export async function submitCommandInput(
  input: { value: string },
  send: (text: string) => Promise<boolean>,
): Promise<boolean> {
  const text = input.value.trim();
  if (!text || !await send(text)) return false;
  input.value = '';
  return true;
}
