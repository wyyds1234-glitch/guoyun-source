import { readFileSync, writeFileSync } from "node:fs";

const entries = [
  ["icp4", "src-tauri/icons/16x16.png"],
  ["icp5", "src-tauri/icons/32x32.png"],
  ["ic07", "src-tauri/icons/128x128.png"],
  ["ic08", "src-tauri/icons/128x128@2x.png"],
  ["ic09", "src-tauri/icons/512x512.png"],
  ["ic10", "src-tauri/icons/icon.png"],
];

const chunks = entries.map(([type, path]) => {
  const data = readFileSync(path);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
});
const body = Buffer.concat(chunks);
const header = Buffer.alloc(8);
header.write("icns", 0, 4, "ascii");
header.writeUInt32BE(body.length + 8, 4);
writeFileSync("src-tauri/icons/icon.icns", Buffer.concat([header, body]));
