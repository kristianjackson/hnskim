const smokeUrl = process.argv[2] ?? process.env.SMOKE_URL;

if (!smokeUrl) {
  console.error("Usage: npm run smoke:web -- https://your-app.example");
  process.exit(1);
}

const baseUrl = new URL(smokeUrl);
const paths = ["/", "/auth", "/diagnostics"];

for (const path of paths) {
  const target = new URL(path, baseUrl);
  const response = await fetch(target, {
    redirect: "manual",
  });

  console.log(`${response.status} ${response.statusText} ${target.toString()}`);

  if (response.status >= 400) {
    process.exit(1);
  }
}
