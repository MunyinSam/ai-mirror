// ai-mirror entry point

async function example() {
  try {
    const result = await fetch("https://example.com");
    return result.json();
  } catch (e) {
    console.error(e);
  }
}
