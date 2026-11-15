import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRate, validateProbe, validateTimeline, assembleFilm } from "./assemble-film.mjs";

assert.equal(parseRate("24000/1000"), 24);
assert.equal(parseRate("24/1"), 24);
assert.throws(() => parseRate("24/0"), /denominator/);
assert.throws(() => parseRate("bad"), /Invalid/);

const film = { fps: 24, width: 1920, height: 1080, totalFrames: 480,
  shots: [{ id: "scene-001", startFrame: 0, endFrame: 480, frames: 480 }] };
assert.equal(validateTimeline(film), true);
assert.throws(() => validateTimeline({ ...film, totalFrames: 481 }), /mismatch/);
assert.throws(() => validateTimeline({ ...film, shots: [{ ...film.shots[0], startFrame: 1 }] }), /Noncontiguous/);
const probe = { streams: [{ codec_type: "video", width: 1920, height: 1080,
  avg_frame_rate: "24/1", nb_frames: "480" }] };
assert.doesNotThrow(() => validateProbe(probe, film.shots[0], film));
assert.throws(() => validateProbe({ streams: [{ ...probe.streams[0], width: 1080 }] }, film.shots[0], film), /dimensions/);
assert.throws(() => validateProbe({ streams: [{ ...probe.streams[0], nb_frames: "479" }] }, film.shots[0], film), /frame count/);
assert.throws(() => validateProbe({ streams: [...probe.streams, { codec_type: "audio" }] }, film.shots[0], film), /silent/);

// assembleFilm keeps its scratch directory out of the way: the .parts directory
// must be cleared before encoding and removed afterwards, on success and on
// failure, unless HTML_ANIME_KEEP_PARTS=1 asks to keep it for debugging.
const twoShotFilm = { fps: 24, width: 1920, height: 1080, totalFrames: 48,
  shots: [
    { id: "scene-001", startFrame: 0, endFrame: 24, frames: 24 },
    { id: "scene-002", startFrame: 24, endFrame: 48, frames: 24 },
  ] };

// Stands in for ffmpeg/ffprobe so the test needs no FFmpeg install.
function fakeToolchain(target, { failOnConcat = false } = {}) {
  let probes = 0;
  return async (binary, args) => {
    if (binary === "ffprobe") {
      const frames = probes < target.shots.length ? target.shots[probes].frames : target.totalFrames;
      probes++;
      return JSON.stringify({ streams: [{ codec_type: "video", width: target.width,
        height: target.height, avg_frame_rate: "24/1", nb_frames: String(frames) }] });
    }
    if (failOnConcat && args.includes("-filter_complex")) throw new Error("ffmpeg exited 1: concat failed");
    await writeFile(args[args.length - 1], "");
    return "";
  };
}

async function partsFixture() {
  const root = await mkdtemp(join(tmpdir(), "html-anime-parts-"));
  const shotsDirectory = join(root, "rendered");
  await mkdir(shotsDirectory, { recursive: true });
  for (const shot of twoShotFilm.shots) await writeFile(join(shotsDirectory, `${shot.id}.mp4`), "");
  const timelinePath = join(root, "timeline.json");
  await writeFile(timelinePath, JSON.stringify(twoShotFilm));
  return { root, shotsDirectory, timelinePath, output: join(root, "final", "film.mp4") };
}

const success = await partsFixture();
try {
  const out = await assembleFilm(success.timelinePath, success.shotsDirectory, success.output,
    { runCommand: fakeToolchain(twoShotFilm) });
  assert.equal(out, success.output);
  assert.ok(existsSync(out), "the assembled film is written");
  assert.equal(existsSync(out + ".parts"), false, "a successful assembly leaves no .parts directory");
} finally {
  await rm(success.root, { recursive: true, force: true });
}

const failure = await partsFixture();
try {
  await assert.rejects(
    assembleFilm(failure.timelinePath, failure.shotsDirectory, failure.output,
      { runCommand: fakeToolchain(twoShotFilm, { failOnConcat: true }) }),
    /concat failed/);
  assert.equal(existsSync(failure.output + ".parts"), false, "a failed assembly leaves no .parts directory");
} finally {
  await rm(failure.root, { recursive: true, force: true });
}

const kept = await partsFixture();
try {
  const staleDir = kept.output + ".parts";
  await mkdir(staleDir, { recursive: true });
  await writeFile(join(staleDir, "part-999.mp4"), "left over from a crashed run");
  process.env.HTML_ANIME_KEEP_PARTS = "1";
  await assembleFilm(kept.timelinePath, kept.shotsDirectory, kept.output,
    { runCommand: fakeToolchain(twoShotFilm) });
  delete process.env.HTML_ANIME_KEEP_PARTS;
  assert.deepEqual((await readdir(staleDir)).sort(), ["part-000.mp4", "part-001.mp4"],
    "stale parts are cleared before encoding and kept when HTML_ANIME_KEEP_PARTS=1");
} finally {
  delete process.env.HTML_ANIME_KEEP_PARTS;
  await rm(kept.root, { recursive: true, force: true });
}

console.log("Film assembler validation tests passed");
