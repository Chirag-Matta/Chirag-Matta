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
          weeks {
            contributionDays { date contributionCount color }
          }
        }
        restrictedContributionsCount
      }
    }
  }
`;

// ---- 1. fetch every year of contribution days since account creation ----

const { user } = await gql(USER_QUERY, { login: LOGIN });
const startYear = new Date(user.createdAt).getUTCFullYear();
const endYear = new Date().getUTCFullYear();

const dayMap = new Map(); // date string -> { count, color }
let grandRestricted = 0;

for (let y = startYear; y <= endYear; y++) {
  const from = `${y}-01-01T00:00:00Z`;
  const to = `${y}-12-31T23:59:59Z`;
  const { user: u } = await gql(YEAR_QUERY, { login: LOGIN, from, to });
  grandRestricted += u.contributionsCollection.restrictedContributionsCount;
  for (const w of u.contributionsCollection.contributionCalendar.weeks) {
    for (const d of w.contributionDays) {
      dayMap.set(d.date, { count: d.contributionCount, color: d.color });
    }
  }
}

// ---- 2. lay every day onto one continuous week/weekday grid ----

const COLOR_LEVEL = {
  "#ebedf0": 0,
  "#9be9a8": 1,
  "#40c463": 2,
  "#30a14e": 3,
  "#216e39": 4,
};

const dates = [...dayMap.keys()].sort();
const firstDate = new Date(dates[0] + "T00:00:00Z");
const firstSunday = new Date(firstDate);
firstSunday.setUTCDate(firstDate.getUTCDate() - firstDate.getUTCDay());

const grandTotal = [...dayMap.values()].reduce((s, d) => s + d.count, 0);

const grid = new Map(); // "x,y" -> { x, y, level, date }
for (const [date, { color }] of dayMap) {
  const d = new Date(date + "T00:00:00Z");
  const dayIndex = Math.round((d - firstSunday) / 86400000);
  const x = Math.floor(dayIndex / 7);
  const y = dayIndex % 7;
  grid.set(`${x},${y}`, { x, y, level: COLOR_LEVEL[color] ?? 0, date });
}

const width = Math.max(...[...grid.values()].map((c) => c.x)) + 1;
const height = 7;

// ---- 3. boustrophedon path across the whole grid ----

const path = [];
for (let x = 0; x < width; x++) {
  if (x % 2 === 0) for (let y = 0; y < height; y++) path.push({ x, y });
  else for (let y = height - 1; y >= 0; y--) path.push({ x, y });
}

const totalSteps = path.length;
path.forEach((p, step) => {
  const cell = grid.get(`${p.x},${p.y}`);
  if (cell && cell.level > 0) cell.t = step / totalSteps;
});

// ---- 4. snake body trails the head by a few cells along the same path ----

const SNAKE_LENGTH = 4;
const bodyPositions = Array.from({ length: SNAKE_LENGTH }, (_, i) =>
  path.map((_, step) => path[Math.max(0, step - i)]),
);

// drop points that fall on a straight line between their neighbors -
// CSS keyframes interpolate linearly, so redundant collinear points are free to remove
const compress = (positions) =>
  positions
    .map((p, i) => ({ t: i / (positions.length - 1), x: p.x, y: p.y }))
    .filter((p, i, arr) => {
      if (i === 0 || i === arr.length - 1) return true;
      const a = arr[i - 1];
      const b = arr[i + 1];
      const ex = (a.x + b.x) / 2;
      const ey = (a.y + b.y) / 2;
      return !(Math.abs(ex - p.x) < 1e-6 && Math.abs(ey - p.y) < 1e-6);
    });

// ---- 5. render ----

const STEP_MS = 45;
const duration = totalSteps * STEP_MS;
const cell = 11;
const gap = 2;
const cellStep = cell + gap;
const margin = cell;
const headerH = 28;

const LIGHT = {
  bg: "#ffffff",
  fg: "#24292f",
  border: "#1b1f230a",
  dots: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  snake: "#8250df",
};
const DARK = {
  bg: "#0d1117",
  fg: "#c9d1d9",
  border: "#1b1f230a",
  dots: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"],
  snake: "#bc8cff",
};

const pct = (t) => (t * 100).toFixed(3) + "%";

function renderSvg(palette) {
  const svgWidth = width * cellStep + margin * 2;
  const svgHeight = height * cellStep + margin * 2 + headerH;

  const gridRects = [];
  const cellKeyframes = [];
  let uid = 0;

  for (const c of grid.values()) {
    const x = c.x * cellStep + margin;
    const y = c.y * cellStep + margin + headerH;

    if (c.t !== undefined) {
      const id = "c" + (uid++).toString(36);
      cellKeyframes.push(
        `@keyframes ${id}{${pct(Math.max(0, c.t - 0.0005))}{fill:var(--c${c.level})}${pct(c.t + 0.0005)}{fill:var(--ce)}100%{fill:var(--ce)}}`,
      );
      gridRects.push(
        `<rect class="d" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" style="fill:var(--c${c.level});animation-name:${id}"><title>${c.date}</title></rect>`,
      );
    } else {
      gridRects.push(
        `<rect class="d" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" style="fill:var(--ce)"><title>${c.date}</title></rect>`,
      );
    }
  }

  const snakeRects = [];
  const snakeKeyframes = [];
  bodyPositions.forEach((positions, i) => {
    const kf = compress(positions);
    const id = "s" + i;
    const size = i === 0 ? cell * 0.95 : cell * (0.85 - i * 0.08);
    const m = (cell - size) / 2;
    const frames = kf
      .map(
        (p) =>
          `${pct(p.t)}{transform:translate(${(p.x * cellStep + margin).toFixed(1)}px,${(p.y * cellStep + margin + headerH).toFixed(1)}px)}`,
      )
      .join("");
    snakeKeyframes.push(`@keyframes ${id}{${frames}}`);
    snakeRects.push(
      `<rect class="snake" x="${m.toFixed(1)}" y="${m.toFixed(1)}" width="${size.toFixed(1)}" height="${size.toFixed(1)}" rx="3" style="animation-name:${id}"/>`,
    );
  });

  const restrictedNote = grandRestricted
    ? ` (+${grandRestricted} private/org-restricted)`
    : "";

  const style = `
    :root{--ce:${palette.dots[0]};--c0:${palette.dots[0]};--c1:${palette.dots[1]};--c2:${palette.dots[2]};--c3:${palette.dots[3]};--c4:${palette.dots[4]};--cs:${palette.snake};--cb:${palette.border}}
    .d{shape-rendering:geometricPrecision;stroke-width:1px;stroke:var(--cb);animation:none ${duration}ms linear infinite}
    .snake{fill:var(--cs);animation:none ${duration}ms linear infinite}
    text{font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif}
    ${cellKeyframes.join("")}
    ${snakeKeyframes.join("")}
  `.replace(/\s+/g, " ");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`,
    `<desc>${LOGIN} full-history contribution snake, generated locally (no third-party snake code)</desc>`,
    `<rect width="100%" height="100%" fill="${palette.bg}"/>`,
    `<style>${style}</style>`,
    `<text x="${margin}" y="18" font-size="13" font-weight="600" fill="${palette.fg}">${LOGIN} — ${grandTotal} contributions since ${startYear}${restrictedNote}</text>`,
    ...gridRects,
    ...snakeRects,
    `</svg>`,
  ].join("");
}

mkdirSync("dist", { recursive: true });
writeFileSync("dist/github-snake.svg", renderSvg(LIGHT));
writeFileSync("dist/github-snake-dark.svg", renderSvg(DARK));

console.log(
  `Generated full-history snake: ${grandTotal} contributions, ${width}x${height} grid (${totalSteps} cells) since ${startYear} (restricted: ${grandRestricted})`,
);
