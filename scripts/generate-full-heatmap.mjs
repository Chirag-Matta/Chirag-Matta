import { mkdirSync, writeFileSync } from "node:fs";

const TOKEN = process.env.CONTRIB_TOKEN;
const LOGIN = process.env.GH_LOGIN;

if (!TOKEN) {
  console.error("Missing CONTRIB_TOKEN secret (personal access token, scope: read:user)");
  process.exit(1);
}
if (!LOGIN) {
  console.error("Missing GH_LOGIN env var");
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const USER_QUERY = `
  query($login: String!) {
    user(login: $login) { createdAt }
  }
`;

const YEAR_QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount color }
          }
        }
        restrictedContributionsCount
      }
    }
  }
`;

const { user } = await gql(USER_QUERY, { login: LOGIN });
const startYear = new Date(user.createdAt).getUTCFullYear();
const endYear = new Date().getUTCFullYear();

const years = [];
for (let y = endYear; y >= startYear; y--) {
  const from = `${y}-01-01T00:00:00Z`;
  const to = `${y}-12-31T23:59:59Z`;
  const { user: u } = await gql(YEAR_QUERY, { login: LOGIN, from, to });
  years.push({
    year: y,
    weeks: u.contributionsCollection.contributionCalendar.weeks,
    total: u.contributionsCollection.contributionCalendar.totalContributions,
    restricted: u.contributionsCollection.restrictedContributionsCount,
  });
}

const grandTotal = years.reduce((s, y) => s + y.total, 0);
const grandRestricted = years.reduce((s, y) => s + y.restricted, 0);

const LIGHT_MAP = {
  "#ebedf0": "#ebedf0",
  "#9be9a8": "#9be9a8",
  "#40c463": "#40c463",
  "#30a14e": "#30a14e",
  "#216e39": "#216e39",
};
const DARK_MAP = {
  "#ebedf0": "#161b22",
  "#9be9a8": "#0e4429",
  "#40c463": "#006d32",
  "#30a14e": "#26a641",
  "#216e39": "#39d353",
};

function renderSvg(colorMap, bg, fg) {
  const cell = 10;
  const gap = 3;
  const step = cell + gap;
  const leftLabel = 40;
  const rightLabel = 46;
  const topPad = 34;
  const rowGap = 20;
  const maxWeeks = Math.max(...years.map((y) => y.weeks.length));
  const width = leftLabel + maxWeeks * step + rightLabel;
  const rowHeight = 7 * step;
  const height = topPad + years.length * (rowHeight + rowGap);

  let body = "";
  years.forEach((y, i) => {
    const yOff = topPad + i * (rowHeight + rowGap);
    body += `<text x="0" y="${yOff + rowHeight / 2}" dy="4" font-size="12" fill="${fg}" font-family="sans-serif">${y.year}</text>`;
    y.weeks.forEach((w, wi) => {
      w.contributionDays.forEach((d, di) => {
        const x = leftLabel + wi * step;
        const yPos = yOff + di * step;
        const color = colorMap[d.color] || d.color;
        body += `<rect x="${x}" y="${yPos}" width="${cell}" height="${cell}" rx="2" fill="${color}"><title>${d.date}: ${d.contributionCount}</title></rect>`;
      });
    });
    body += `<text x="${leftLabel + maxWeeks * step + 6}" y="${yOff + rowHeight / 2}" dy="4" font-size="11" fill="${fg}" font-family="sans-serif">${y.total}</text>`;
  });

  const restrictedNote = grandRestricted
    ? ` (+${grandRestricted} private/org-restricted)`
    : "";
  const header = `<text x="0" y="16" font-size="14" font-weight="bold" fill="${fg}" font-family="sans-serif">${LOGIN} — ${grandTotal} contributions since ${startYear}${restrictedNote}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${bg}"/>${header}${body}</svg>`;
}

mkdirSync("dist", { recursive: true });
writeFileSync("dist/full-heatmap.svg", renderSvg(LIGHT_MAP, "#ffffff", "#24292f"));
writeFileSync("dist/full-heatmap-dark.svg", renderSvg(DARK_MAP, "#0d1117", "#c9d1d9"));

console.log(
  `Generated heatmap: ${grandTotal} total contributions across ${years.length} years (restricted: ${grandRestricted})`,
);
