// ==UserScript==
// @name         VKM
// @namespace    http://tampermonkey.net/
// @version      a0.9.0.8
// @description  Music Downloader
// @author       downsyndrome
// @match        https://vk.ru/*
// @match        https://vk.com/*
// @icon         https://vk.ru/images/icons/favicons/fav_logo.ico
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js
// @connect      vkuseraudio.net
// @connect      vkuseraudio.ru
// @connect      userapi.com
// @connect      cdn.jsdelivr.net
// @connect      vk.ru
// @connect      vk.com
// @connect      vkuserphoto.ru
// @connect      itunes.apple.com
// @connect      mzstatic.com
// ==/UserScript==

(() => {
    'use strict';

    const FFMPEG_CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js';
    const FFMPEG_WASM = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm';
    const FFMPEG_WORKER = `var u="0.12.9",R=\`https://unpkg.com/@ffmpeg/core@\${u}/dist/umd/ffmpeg-core.js\`,s;(function(t){t.LOAD="LOAD",t.EXEC="EXEC",t.FFPROBE="FFPROBE",t.WRITE_FILE="WRITE_FILE",t.READ_FILE="READ_FILE",t.DELETE_FILE="DELETE_FILE",t.RENAME="RENAME",t.CREATE_DIR="CREATE_DIR",t.LIST_DIR="LIST_DIR",t.DELETE_DIR="DELETE_DIR",t.ERROR="ERROR",t.DOWNLOAD="DOWNLOAD",t.PROGRESS="PROGRESS",t.LOG="LOG",t.MOUNT="MOUNT",t.UNMOUNT="UNMOUNT"})(s||(s={}));var a=new Error("unknown message type"),f=new Error("ffmpeg is not loaded, call \`await ffmpeg.load()\` first"),F=new Error("called FFmpeg.terminate()"),O=new Error("failed to import ffmpeg-core.js");var r,l=async({coreURL:t,wasmURL:o,workerURL:e,wasmBinary:wB})=>{let n=!r;try{t||(t=R),importScripts(t)}catch{if((!t||t===R)&&(t=R.replace("/umd/","/esm/")),self.createFFmpegCore=(await import(t)).default,!self.createFFmpegCore)throw O}let E=t,c=o||t.replace(/.js$/g,".wasm"),m=e||t.replace(/.js$/g,".worker.js");return r=await self.createFFmpegCore({wasmBinary:wB,mainScriptUrlOrBlob:\`\${E}#\${btoa(JSON.stringify({wasmURL:c,workerURL:m}))}\`}),r.setLogger(i=>self.postMessage({type:s.LOG,data:i})),r.setProgress(i=>self.postMessage({type:s.PROGRESS,data:i})),n},D=({args:t,timeout:o=-1})=>{r.setTimeout(o),r.exec(...t);let e=r.ret;return r.reset(),e},I=({args:t,timeout:o=-1})=>{r.setTimeout(o),r.ffprobe(...t);let e=r.ret;return r.reset(),e},S=({path:t,data:o})=>(r.FS.writeFile(t,o),!0),p=({path:t,encoding:o})=>r.FS.readFile(t,{encoding:o}),L=({path:t})=>(r.FS.unlink(t),!0),A=({oldPath:t,newPath:o})=>(r.FS.rename(t,o),!0),N=({path:t})=>(r.FS.mkdir(t),!0),T=({path:t})=>{let o=r.FS.readdir(t),e=[];for(let n of o){let E=r.FS.stat(\`\${t}/\${n}\`),c=r.FS.isDir(E.mode);e.push({name:n,isDir:c})}return e},w=({path:t})=>(r.FS.rmdir(t),!0),k=({fsType:t,options:o,mountPoint:e})=>{let n=t,E=r.FS.filesystems[n];return E?(r.FS.mount(E,o,e),!0):!1},_=({mountPoint:t})=>(r.FS.unmount(t),!0);self.onmessage=async({data:{id:t,type:o,data:e}})=>{let n=[],E;try{if(o!==s.LOAD&&!r)throw f;switch(o){case s.LOAD:E=await l(e);break;case s.EXEC:E=D(e);break;case s.FFPROBE:E=I(e);break;case s.WRITE_FILE:E=S(e);break;case s.READ_FILE:E=p(e);break;case s.DELETE_FILE:E=L(e);break;case s.RENAME:E=A(e);break;case s.CREATE_DIR:E=N(e);break;case s.LIST_DIR:E=T(e);break;case s.DELETE_DIR:E=w(e);break;case s.MOUNT:E=k(e);break;case s.UNMOUNT:E=_(e);break;default:throw a}}catch(c){self.postMessage({id:t,type:s.ERROR,data:c.toString()});return}E instanceof Uint8Array&&n.push(E.buffer),self.postMessage({id:t,type:o,data:E},n)};`;

    const win = unsafeWindow;
    const audioCache = new Map();
    let ffmpegPromise = null;

    function request(url, responseType) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                ...(responseType && { responseType }),
                timeout: 30000,
                onload: r => r.status === 200 ? resolve(responseType ? r.response : r.responseText) : reject(new Error(`HTTP ${r.status}`)),
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Timeout'))
            });
        });
    }

    const fetchBuffer = url => request(url, 'arraybuffer');
    const fetchText = url => request(url);

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('VKM_Cache', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('files');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getCached(key, url) {
        let db;
        try {
            db = await openDB();
            const cached = await new Promise(resolve => {
                const req = db.transaction('files').objectStore('files').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            });
            if (cached) return cached;
        } catch {}

        const buffer = await fetchBuffer(url);
        try {
            db?.transaction('files', 'readwrite').objectStore('files').put(buffer, key);
        } catch {}
        return buffer;
    }

    function getFFmpeg() {
        ffmpegPromise ??= (async () => {
            const ffmpeg = new FFmpegWASM.FFmpeg();
            const [core, wasmBinary] = await Promise.all([
                getCached('ffmpeg-core.js', FFMPEG_CORE),
                getCached('ffmpeg-core.wasm', FFMPEG_WASM)
            ]);
            await ffmpeg.load({
                coreURL: URL.createObjectURL(new Blob([core], { type: 'text/javascript' })),
                classWorkerURL: URL.createObjectURL(new Blob([FFMPEG_WORKER], { type: 'text/javascript' })),
                wasmBinary
            });
            return ffmpeg;
        })().catch(error => {
            ffmpegPromise = null;
            throw error;
        });
        return ffmpegPromise;
    }

    function parseM3U8(content) {
        const segments = [];
        let seq = 0;
        let keyUrl = null;

        for (const line of content.split('\n').map(l => l.trim())) {
            if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                seq = parseInt(line.split(':')[1], 10);
            } else if (line.startsWith('#EXT-X-KEY:')) {
                keyUrl = /METHOD=AES-128/.test(line) ? (line.match(/URI="([^"]+)"/)?.[1] ?? null) : null;
            } else if (line && !line.startsWith('#')) {
                segments.push({ url: line, keyUrl, seq: seq++ });
            }
        }
        return segments;
    }

    async function decryptSegment(data, keyBuffer, seq) {
        const key = await crypto.subtle.importKey('raw', keyBuffer, 'AES-CBC', false, ['decrypt']);
        const iv = new Uint8Array(16);
        new DataView(iv.buffer).setUint32(12, seq);
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
    }

    const encode = text => new TextEncoder().encode(text);
    const syncsafe = n => [(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F];

    function concat(parts) {
        const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
        let offset = 0;
        for (const p of parts) {
            out.set(p, offset);
            offset += p.length;
        }
        return out;
    }

    const createFrame = (id, payload) => concat([encode(id), syncsafe(payload.length), [0, 0], payload]);

    function createID3Tag(audio, cover) {
        const frames = [
            createFrame('TIT2', concat([[3], encode(audio.title || '')])),
            createFrame('TPE1', concat([[3], encode(audio.artist || '')]))
        ];

        if (cover) {
            const bytes = new Uint8Array(cover);
            const mime = bytes[0] === 0xFF ? 'image/jpeg' : bytes[0] === 0x89 ? 'image/png' : 'application/octet-stream';
            frames.push(createFrame('APIC', concat([[3], encode(`${mime}\0`), [3, 0], bytes])));
        }

        const body = concat(frames);
        return concat([encode('ID3'), [4, 0, 0], syncsafe(body.length), body]);
    }

    function getThumbnailUrl(audio) {
        const thumb = audio.thumb;
        const id = Number(thumb?.id);
        if (!thumb || (id >= 457239149 && id <= 457239155)) return null;
        return [1200, 600, 300, 270, 135, 68, 34].map(size => thumb[`photo_${size}`]).find(Boolean) || null;
    }

    const transliteration = {
        а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
        з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
        п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
        ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
    };

    const normalize = text => String(text ?? '')
        .toLocaleLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[([{]\s*(?:feat(?:uring)?|ft|with)\.?(?=\s|$).*?[)\]}]/g, '')
        .replace(/\s+(?:feat(?:uring)?|ft)\.?(?=\s|$).*$/g, '')
        .replace(/[а-яё]/g, char => transliteration[char] ?? char)
        .replace(/[^\p{L}\p{N}]+/gu, '');

    async function searchItunes(term, country) {
        try {
            const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=10&country=${country}`;
            const data = JSON.parse(await fetchText(url));
            return Array.isArray(data.results) ? data.results : [];
        } catch {
            return [];
        }
    }

    async function getItunesCover(audio) {
        const title = normalize(audio.title);
        const artist = normalize(audio.artist);
        if (!title || !artist) return null;

        const term = encodeURIComponent(`${audio.artist} ${audio.title}`);
        const results = (await Promise.all(['us', 'ru'].map(country => searchItunes(term, country)))).flat();

        const match = results.find(result => {
            const trackTitle = normalize(result.trackName);
            const trackArtist = normalize(result.artistName);
            return Boolean(result.artworkUrl100)
                && Boolean(trackTitle)
                && Boolean(trackArtist)
                && trackTitle === title
                && trackArtist === artist;
        });
        if (!match) return null;

        for (const size of [1200, 600]) {
            try {
                const coverUrl = match.artworkUrl100.replace(/\d+x\d+bb(?=\.\w+$)/, `${size}x${size}bb`);
                return await fetchBuffer(coverUrl);
            } catch {}
        }
        return null;
    }

    async function getCover(audio) {
        const url = getThumbnailUrl(audio);
        if (url) {
            try {
                return await fetchBuffer(url);
            } catch {}
        }
        return getItunesCover(audio);
    }

    async function downloadHLS(audio, onProgress) {
        const ffmpeg = await getFFmpeg();
        const segments = parseM3U8(await fetchText(audio.url));
        if (!segments.length) throw new Error('No segments');

        const keys = new Map();
        const files = [];
        let output;

        try {
            for (const [i, seg] of segments.entries()) {
                let data = await fetchBuffer(new URL(seg.url, audio.url).href);

                if (seg.keyUrl) {
                    const keyUrl = new URL(seg.keyUrl, audio.url).href;
                    if (!keys.has(keyUrl)) keys.set(keyUrl, await fetchBuffer(keyUrl));
                    data = await decryptSegment(data, keys.get(keyUrl), seg.seq);
                }

                await ffmpeg.writeFile(`s${i}.ts`, new Uint8Array(data));
                files.push(`s${i}.ts`);
                onProgress((i + 1) / segments.length);
            }

            await ffmpeg.writeFile('list.txt', files.map(f => `file '${f}'`).join('\n'));
            await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'out.mp3']);
            output = await ffmpeg.readFile('out.mp3');
        } finally {
            await Promise.all([...files, 'list.txt', 'out.mp3'].map(f => ffmpeg.deleteFile(f).catch(() => {})));
        }

        const cover = await getCover(audio);

        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([createID3Tag(audio, cover), output], { type: 'audio/mpeg' }));
        link.download = `${audio.artist} - ${audio.title}.mp3`.replace(/[/\\?%*:|"<>]/g, '-');
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    function findAudios(obj) {
        if (!obj || typeof obj !== 'object') return;

        if (Array.isArray(obj)) {
            for (const item of obj) {
                if (item?.url && item.owner_id != null && item.id != null) {
                    audioCache.set(`${item.owner_id}_${item.id}`, item);
                }
            }
        }

        Object.values(obj).forEach(findAudios);
    }

    const isMethodUrl = url => /\/method\//.test(String(url));

    const origOpen = win.XMLHttpRequest.prototype.open;
    win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (isMethodUrl(url)) {
            this.addEventListener('load', () => {
                try {
                    findAudios(JSON.parse(this.responseText));
                } catch {}
            });
        }
        return origOpen.call(this, method, url, ...rest);
    };

    const origFetch = win.fetch;
    win.fetch = async (...args) => {
        const res = await origFetch.apply(win, args);
        if (isMethodUrl(args[0]?.url ?? args[0])) {
            res.clone().json().then(findAudios).catch(() => {});
        }
        return res;
    };

    GM_addStyle('.vkm-dl-btn{width:24px;height:24px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;position:relative;z-index:1}.vkm-dl-btn:disabled{opacity:.4;cursor:not-allowed}.vkm-progress{width:60px;height:2px;background:linear-gradient(#4A76A8,#4A76A8) left/var(--p,0%) 100% no-repeat,#F2F4F7}');

    function createButton(actions, container, sample) {
        const btn = document.createElement('button');
        btn.className = `vkm-dl-btn ${sample.className}`;
        btn.type = 'button';
        btn.title = 'Download';
        btn.innerHTML = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 17.75a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H4.75a.75.75 0 0 1-.75-.75" clip-rule="evenodd"/><path d="M10.75 2.726c0-.401-.336-.726-.75-.726a.74.74 0 0 0-.75.726v9.722l-3.97-3.97a.75.75 0 0 0-1.06 1.06l5.245 5.246a.75.75 0 0 0 1.06 0l5.257-5.256a.75.75 0 0 0-1.061-1.061l-3.972 3.972z"/></svg>';

        const iconClass = sample.querySelector('svg')?.getAttribute('class');
        if (iconClass) btn.firstElementChild.setAttribute('class', iconClass);

        btn.onclick = async e => {
            e.preventDefault();
            e.stopPropagation();

            const audio = audioCache.get(actions.closest('[data-audio-id]')?.dataset.audioId);
            if (!audio) return;

            btn.disabled = true;
            const bar = document.createElement('div');
            bar.className = 'vkm-progress';
            container.prepend(bar);

            try {
                await downloadHLS(audio, p => bar.style.setProperty('--p', `${p * 100}%`));
            } catch {}
            finally {
                bar.remove();
                btn.disabled = false;
            }
        };

        return btn;
    }

    function addButton(actions) {
        const container = actions.querySelector(':scope > div') || actions;
        let wrap = actions.querySelector('.vkm-dl-wrap');

        if (!wrap) {
            const sample = container.querySelector('button');
            if (!sample) return;

            wrap = document.createElement('div');
            wrap.className = `${container.firstElementChild?.className || ''} vkm-dl-wrap`;
            wrap.appendChild(createButton(actions, container, sample));
        }

        const target = [...container.children].filter(c => c !== wrap && !c.classList.contains('vkm-progress')).at(-1) ?? null;
        if (wrap.parentElement !== container || wrap.nextElementSibling !== target) {
            container.insertBefore(wrap, target);
        }
    }

    let scanTimer = 0;

    function scan() {
        scanTimer = 0;
        document.querySelectorAll('[data-testid="audiorow-actions"]').forEach(addButton);
    }

    new MutationObserver(() => {
        scanTimer ||= setTimeout(scan, 100);
    }).observe(document, { childList: true, subtree: true });

    scan();
})();