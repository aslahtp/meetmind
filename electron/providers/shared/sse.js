// Server-sent-events reader shared by the streaming LLM providers.

/**
 * Yield each JSON event of a server-sent-events body. Skips the OpenAI-style
 * `data: [DONE]` sentinel, which marks the end of the stream and isn't JSON.
 */
async function* readEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = done ? '' : frames.pop();
    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
    if (done) return;
  }
}

module.exports = { readEvents };
