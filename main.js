import express from 'express';
import cors from 'cors';
import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory';
import { RxDBJsonDumpPlugin } from 'rxdb/plugins/json-dump';
import turndown from 'turndown';
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import slugify from 'slugify';
import yaml from 'js-yaml';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

if (!globalThis.crypto) {
    globalThis.crypto = crypto.webcrypto;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Add necessary plugins
addRxPlugin(RxDBJsonDumpPlugin);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/Clips', express.static(path.join(__dirname, 'Clips')));
app.use(express.static(__dirname));

const tdService = new turndown({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
});

const clipSchema = {
    title: 'clip schema',
    version: 0,
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: { type: 'string', maxLength: 100 },
        title: { type: 'string' },
        url: { type: 'string' },
        content: { type: 'string' }, // Store markdown content
        localPath: { type: 'string' },
        createdAt: { type: 'string' }
    },
    required: ['id', 'title', 'url', 'content', 'localPath', 'createdAt']
};

let db;
const DUMP_PATH = path.join(__dirname, 'rxdb_data.json');

async function initDB() {
    db = await createRxDatabase({
        name: 'knowledge_hub',
        storage: getRxStorageMemory(),
        multiInstance: false
    });

    await db.addCollections({
        clippings: { schema: clipSchema }
    });
    
    // Load existing data if available
    try {
        const dumpData = await fs.readFile(DUMP_PATH, 'utf-8');
        const json = JSON.parse(dumpData);
        await db.clippings.importJSON(json);
        console.log('📦 Loaded RxDB Knowledge Hub data from disk.');
    } catch (e) {
        if (e.code !== 'ENOENT') {
            console.error('Failed to load DB dump:', e);
        } else {
            console.log('📦 Created new RxDB Knowledge Hub.');
        }
    }

    // Persist data when it changes
    db.clippings.$.subscribe(async () => {
        try {
            const dump = await db.clippings.exportJSON();
            await fs.writeFile(DUMP_PATH, JSON.stringify(dump, null, 2));
        } catch (e) {
            console.error('Failed to dump DB:', e);
        }
    });
}

async function downloadImage(url, destPath) {
    try {
        const response = await axios({ url, responseType: 'arraybuffer', timeout: 10000 });
        await fs.writeFile(destPath, response.data);
        return true;
    } catch (e) {
        console.error(`Failed to download ${url}: ${e.message}`);
        return false;
    }
}

// Server-side HTML sanitizer — strips scripts, styles, base64, comments
function sanitizeHtml(html) {
    return html
        // Remove script/style/svg/noscript blocks
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<svg[\s\S]*?<\/svg>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        // Remove base64 data URIs (they cause massive file sizes)
        .replace(/src="data:[^"]*"/gi, 'src=""')
        .replace(/src='data:[^']*'/gi, "src=''")
        // Remove inline event handlers
        .replace(/ on\w+="[^"]*"/gi, '')
        .replace(/ on\w+='[^']*'/gi, '')
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, '')
        // Collapse excessive whitespace
        .replace(/\s{3,}/g, '\n')
        .trim();
}

app.post('/api/clip', async (req, res) => {
    try {
        const { title, url, html, imageUrls } = req.body;
        
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        
        const safeSlug = slugify(title, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g }).slice(0, 50) || 'untitled';
        const folderName = `${day}-${safeSlug}`;
        
        const clipsDir = path.join(__dirname, 'Clips', year, month, folderName);
        const assetsDir = path.join(clipsDir, 'assets');
        
        await fs.mkdir(assetsDir, { recursive: true });

        // Process images
        let processedHtml = html;
        let downloadedCount = 0;
        
        if (imageUrls && imageUrls.length > 0) {
            for (let i = 0; i < imageUrls.length; i++) {
                const imgUrl = imageUrls[i];
                const ext = path.extname(new URL(imgUrl).pathname) || '.jpg';
                const filename = `img_${i}${ext}`;
                const destPath = path.join(assetsDir, filename);
                
                const success = await downloadImage(imgUrl, destPath);
                if (success) {
                    downloadedCount++;
                    processedHtml = processedHtml.split(imgUrl).join(`./assets/${filename}`);
                }
            }
        }

        // Sanitize HTML before conversion
        const cleanHtml = sanitizeHtml(processedHtml);

        // Convert to Markdown
        const markdownContent = tdService.turndown(cleanHtml);
        
        const frontmatter = yaml.dump({
            title: title,
            url: url,
            clipped_at: now.toISOString(),
            tags: ['clipping']
        });
        
        const finalFileContent = `---\n${frontmatter}---\n\n${markdownContent}`;
        await fs.writeFile(path.join(clipsDir, 'index.md'), finalFileContent);

        // Save to RxDB
        const docId = Date.now().toString();
        await db.clippings.insert({
            id: docId,
            title,
            url,
            content: markdownContent,
            localPath: path.relative(__dirname, clipsDir),
            createdAt: now.toISOString()
        });

        console.log(`✅ Saved clipping: ${title} to ${clipsDir}`);
        res.json({ success: true, message: 'Clipped and saved to Knowledge Hub', imageCount: downloadedCount });
        
    } catch (err) {
        console.error('Error processing clip:', err);
        res.status(500).send(err.message);
    }
});

app.get('/api/clips', async (req, res) => {
    try {
        const clips = await db.clippings.find({
            sort: [{ createdAt: 'desc' }]
        }).exec();
        res.json(clips.map(c => c.toJSON()));
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.delete('/api/clips/:id', async (req, res) => {
    try {
        const doc = await db.clippings.findOne(req.params.id).exec();
        if (doc) {
            const localPath = doc.localPath;
            const fullPath = path.join(__dirname, localPath);
            
            // Remove from DB
            await doc.remove();
            
            // Remove files
            try {
                await fs.rm(fullPath, { recursive: true, force: true });
            } catch (e) {
                console.error('Failed to delete files:', e);
            }
            
            res.json({ success: true });
        } else {
            res.status(404).send('Not found');
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

const PORT = 44123;
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Knowledge Hub listening on http://127.0.0.1:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize DB:', err);
});
