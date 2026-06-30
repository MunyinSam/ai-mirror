// ai-mirror entry point — v1

async function fetchUser(id: string) {
  try {
    const res = await fetch(`/api/users/${id}`);
    return res.json();
  } catch (e) {
    console.error(e);
  }
}

async function example() {
  try {
    const result = await fetch("https://example.com");
    return result.json();
  } catch (e) {
    console.error(e);
  }
}
