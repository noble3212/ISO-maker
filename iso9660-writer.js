// js/iso9660-writer.js
class ISO9660Writer {
  constructor(volumeLabel = "MY_ISO") {
    this.sectorSize = 2048;
    this.volumeLabel = volumeLabel;
    this.files = []; // list of { path, data }
    this.dirMap = new Map(); // map full folder paths
  }

  addFile(path, data) {
    const normPath = path.replace(/\\/g, '/');
    this.files.push({ path: normPath, data });
    this._registerDirs(normPath);
  }

  _registerDirs(path) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      this.dirMap.set(dir, true);
    }
  }

  _padToSector(data) {
    const padSize = this.sectorSize - (data.length % this.sectorSize || this.sectorSize);
    return new Uint8Array([...data, ...new Uint8Array(padSize)]);
  }

  _str(s, len) {
    const bytes = new TextEncoder().encode(s.toUpperCase().padEnd(len, ' ').substring(0, len));
    return bytes;
  }

  create() {
    const sectors = [];
    const sectorSize = this.sectorSize;

    // Primary Volume Descriptor (sector 16)
    const vd = new Uint8Array(sectorSize).fill(0);
    vd[0] = 0x01;
    vd.set([0x43,0x44,0x30,0x30,0x31],1); vd[6]=0x01;
    vd.set(this._str(this.volumeLabel,32),40);
    const rootEntry = new Uint8Array(34).fill(0);
    rootEntry[0]=34; rootEntry[2]=22; rootEntry[10]=0x02;
    rootEntry[32]=1; rootEntry[33]=0;
    vd.set(rootEntry,156);
    sectors[16] = vd;

    // Fill sectors 0–15
    for (let i = 0; i < 16; i++) sectors[i] = new Uint8Array(sectorSize).fill(0);

    // Collect all entries (dirs + files)
    const entries = [];
    // Add paths for directories first
    [...this.dirMap.keys()].sort().forEach(dirPath => {
      entries.push({ path: dirPath, isDir: true });
    });
    // Then files
    this.files.forEach(f => entries.push({ path: f.path, data: f.data, isDir: false }));

    const startSector = 17;
    let currentSector = 17 + 1; // after VD and reserved

    // Allocate sectors and store index
    for (const e of entries) {
      const sizeBytes = e.isDir
        ? 0
        : this._padToSector(e.data).length;
      const sectorsNeeded = sizeBytes / sectorSize;
      e.lba = currentSector;
      e.size = e.isDir ? 0 : e.data.length;
      currentSector += sectorsNeeded;
      if (!e.isDir) sectors.push(this._padToSector(e.data));
    }

    // Directory record sector
    const dirSectorBuf = new Uint8Array(sectorSize).fill(0);
    let pos = 0;
    function writeEntry(e) {
      const name = e.isDir ? e.path.split('/').pop() || '' : e.path.split('/').pop();
      const nameBuf = new TextEncoder().encode(name + (e.isDir ? ';1' : ';1'));
      const len = 33 + nameBuf.length + (nameBuf.length % 2 === 0 ? 1 : 0);
      const rec = new Uint8Array(len).fill(0);
      rec[0] = len; rec[2] = e.lba & 0xff; rec[3] = (e.lba >> 8) & 0xff;
      rec[18] = e.size & 0xff;
      rec[19] = (e.size >> 8) & 0xff;
      rec[20] = (e.size >> 16) & 0xff;
      rec[21] = (e.size >> 24) & 0xff;
      rec[10] = e.isDir ? 0x02 : 0x00;
      rec[32] = nameBuf.length;
      rec.set(nameBuf, 33);
      return rec;
    }
    entries.forEach(e => {
      const rec = writeEntry(e);
      dirSectorBuf.set(rec, pos);
      pos += rec.length;
    });
    sectors.push(dirSectorBuf);

    // Volume Descriptor Terminator
    const term = new Uint8Array(sectorSize).fill(0);
    term[0]=0xFF; term.set([0x43,0x44,0x30,0x30,0x31],1); term[6]=0x01;
    sectors.push(term);

    // Combine
    const total = new Uint8Array(currentSector * sectorSize);
    sectors.forEach((s, i) => total.set(s, i * sectorSize));
    return total;
  }

  getBlob() {
    return new Blob([this.create()], { type: "application/octet-stream" });
  }
}

