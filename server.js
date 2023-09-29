
const fs = require('fs');
const path = require('path');
const express = require('express');
const logger = require('cyber-express-logger');
const sftp = require('ssh2-sftp-client');
const crypto = require('crypto');
const mime = require('mime');
const bodyParser = require('body-parser');
const archiver = require('archiver');
const rawBodyParser = bodyParser.raw({
    limit: '64mb',
    type: '*/*'
});
const utils = require('web-resources');

const normalizeRemotePath = remotePath => {
    remotePath = path.normalize(remotePath);
    const split = remotePath.split('/').filter(String);
    const joined = `/${split.join('/')}`;
    return joined;
};

const sessions = {};
const sessionActivity = {};

const getObjectHash = obj => {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(obj));
    return hash.digest('hex');
}

/**
 * @param {sftp.ConnectOptions} opts
 * @returns {Promise<sftp>|null}
 * */
const getSession = async(res, opts) => {
    const hash = getObjectHash(opts);
    const address = `${opts.username}@${opts.host}:${opts.port}`;
    if (sessions[hash]) {
        console.log(`Using existing connection to ${address}`);
        sessionActivity[hash] = Date.now();
        return sessions[hash];
    }
    console.log(`Creating new connection to ${address}`);
    const session = new sftp();
    sessions[hash] = session;
    session.on('end', () => delete sessions[hash]);
    session.on('close', () => delete sessions[hash]);
    try {
        await session.connect(opts);
        sessionActivity[hash] = Date.now();
    } catch (error) {
        delete sessions[hash];
        console.log(`Connection to ${address} failed`);
        return res.sendError(error);
    }
    return session;
};

const srv = express();
srv.use(logger());
srv.use(express.static('web'));

srv.use('/api/sftp', async(req, res, next) => {
    res.sendData = (status = 200) => res.status(status).json(res.data);
    res.sendError = (error, status = 400) => {
        res.data.success = false;
        res.data.error = `${error}`.replace('Error: ', '');
        res.sendData(status);
    }
    res.data = {
        success: true
    };
    req.connectionOpts = {
        host: req.headers['sftp-host'],
        port: req.headers['sftp-port'] || 22,
        username: req.headers['sftp-username'],
        password: decodeURIComponent(req.headers['sftp-password'] || '') || undefined,
        privateKey: decodeURIComponent(req.headers['sftp-key'] || '') || undefined,
    };
    if (!req.connectionOpts.host)
        return res.sendError('Missing host header');
    if (!req.connectionOpts.username)
        return res.sendError('Missing username header');
    if (!req.connectionOpts.password && !req.connectionOpts.privateKey)
        return res.sendError('Missing password or key header');
    req.session = await getSession(res, req.connectionOpts);
    if (!req.session) return;
    next();
});
srv.get('/api/sftp/directories/list', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    res.data.includesFiles = req.query.dirsOnly === 'true' ? false : true;
    if (!res.data.path) return res.sendError('Missing path', 400);
    try {
        res.data.list = await session.list(res.data.path);
        if (res.data.list && !res.data.includesFiles) {
            res.data.list = res.data.list.filter(item => item.type === 'd');
        }
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.post('/api/sftp/directories/create', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    try {
        await session.mkdir(res.data.path);
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.delete('/api/sftp/directories/delete', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    try {
        await session.rmdir(res.data.path, true);
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.get('/api/sftp/files/exists', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    try {
        const type = await session.exists(res.data.path);
        res.data.exists = type !== false;
        res.data.type = type;
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.post('/api/sftp/files/create', rawBodyParser, async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    try {
        await session.put(req.body, res.data.path);
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.put('/api/sftp/files/append', rawBodyParser, async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    try {
        await session.append(req.body, res.data.path);
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.delete('/api/sftp/files/delete', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    try {
        await session.delete(res.data.path);
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.put('/api/sftp/files/move', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.pathOld = normalizeRemotePath(req.query.pathOld);
    res.data.pathNew = normalizeRemotePath(req.query.pathNew);
    if (!res.data.pathOld) return res.sendError('Missing source path', 400);
    if (!res.data.pathNew) return res.sendError('Missing destination path', 400);
    try {
        await session.rename(res.data.pathOld, res.data.pathNew);
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.put('/api/sftp/files/copy', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.pathSrc = normalizeRemotePath(req.query.pathSrc);
    res.data.pathDest = normalizeRemotePath(req.query.pathDest);
    if (!res.data.pathSrc) return res.sendError('Missing source path', 400);
    if (!res.data.pathDest) return res.sendError('Missing destination path', 400);
    try {
        await session.rcopy(res.data.pathSrc, res.data.pathDest);
        res.sendData();
    } catch (error) {
        res.sendError(error);
    }
});
srv.get('/api/sftp/files/stat', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    let stats = null;
    try {
        stats = await session.stat(res.data.path);
    } catch (error) {
        return res.sendError(error, 404);
    }
    res.data.stats = stats;
    res.sendData();
});
const downloadSingleFileHandler = async(connectionOpts, res, remotePath, stats) => {
    let interval;
    // Gracefully handle any errors
    try {
        // Throw an error if it's not a file
        if (!stats.isFile) throw new Error('Not a file');
        // Add uniqueness to the connection opts
        // This forces a new connection to be created
        connectionOpts.ts = Date.now();
        // Create the session and throw an error if it fails
        const session = await getSession(res, connectionOpts);
        if (!session) throw new Error('Failed to create session');
        // Continuously update the session activity
        setInterval(() => {
            const hash = getObjectHash(connectionOpts);
            sessionActivity[hash] = Date.now();
        }, 1000*1);
        // When the response closes, end the session
        res.on('close', () => {
            clearInterval(interval);
            session.end();
        });
        // Set response headers
        res.setHeader('Content-Type', mime.getType(remotePath) || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(remotePath)}"`);
        res.setHeader('Content-Length', stats.size);
        // Start the download
        console.log(`Starting download: ${connectionOpts.username}@${connectionOpts.host}:${connectionOpts.port} ${remotePath}`);
        await session.get(remotePath, res);
        // Force-end the response
        res.end();
    // On error, clear the interval and send a 400 response
    } catch (error) {
        clearInterval(interval);
        res.status(400).end();
    }
};
const downloadMultiFileHandler = async(connectionOpts, res, remotePaths, rootPath = '/') => {
    rootPath = normalizeRemotePath(rootPath);
    let interval;
    // Gracefully handle any errors
    try {
        // Add uniqueness to the connection opts
        // This forces a new connection to be created
        connectionOpts.ts = Date.now();
        // Create the session and throw an error if it fails
        const session = await getSession(res, connectionOpts);
        if (!session) throw new Error('Failed to create session');
        // Continuously update the session activity
        setInterval(() => {
            const hash = getObjectHash(connectionOpts);
            sessionActivity[hash] = Date.now();
        }, 1000*1);
        // Set response headers
        let fileName = `Files (${path.basename(rootPath) || 'Root'})`;
        if (remotePaths.length == 1)
            fileName = path.basename(remotePaths[0]);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}.zip"`);
        // Create the archive and start piping to the response
        const archive = archiver('zip');
        archive.pipe(res);
        // When the response closes, end the session
        res.on('close', () => {
            clearInterval(interval);
            archive.end();
            session.end();
        });
        // Add file to the archive
        const addToArchive = async(remotePath) => {
            const archivePath = normalizeRemotePath(remotePath.replace(rootPath, ''));
            console.log(`Zipping: ${connectionOpts.username}@${connectionOpts.host}:${connectionOpts.port} ${remotePath}`);
            // Get file read stream
            const stream = session.createReadStream(remotePath);
            const waitToEnd = new Promise(resolve => {
                stream.on('end', resolve);
            });
            // Add file to archive
            archive.append(stream, {
                name: archivePath
            });
            // Wait for the stream to end
            await waitToEnd;
        };
        // Recurse through directories and archive files
        const recurse = async(remotePath) => {
            try {
                const stats = await session.stat(remotePath);
                if (stats.isFile) {
                    await addToArchive(remotePath);
                } else if (stats.isDirectory) {
                    const list = await session.list(remotePath);
                    for (const item of list) {
                        const subPath = `${remotePath}/${item.name}`;
                        if (item.type === '-') {
                            await addToArchive(subPath);
                        } else {
                            await recurse(subPath);
                        }
                    }
                }
            } catch (error) {}
        };
        for (const remotePath of remotePaths) {
            await recurse(remotePath);
        }
        // Finalize the archive
        archive.on('close', () => res.end());
        archive.finalize();
    // On error, clear the interval and send a 400 response
    } catch (error) {
        clearInterval(interval);
        res.status(400).end();
    }
};
srv.get('/api/sftp/files/get/single', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    // Get the normalized path and throw an error if it's missing
    const remotePath = normalizeRemotePath(req.query.path);
    if (!remotePath) return res.sendError('Missing path', 400);
    try {
        const stats = await session.stat(remotePath);
        // Handle the download
        await downloadSingleFileHandler(req.connectionOpts, res, remotePath, stats);
    } catch (error) {
        res.status(400).end();
    }
});
const rawDownloads = {};
srv.get('/api/sftp/files/get/single/url', async(req, res) => {
    /** @type {sftp} */
    const session = req.session;
    // Get the normalized path and throw an error if it's missing
    res.data.path = normalizeRemotePath(req.query.path);
    if (!res.data.path) return res.sendError('Missing path', 400);
    // Get path stats and throw an error if it's not a file
    let stats = null;
    try {
        stats = await session.stat(res.data.path);
        if (!stats?.isFile) throw new Error('Not a file');
    } catch (error) {
        return res.sendError(error);
    }
    // Generate download URL
    const id = Date.now();
    res.data.download_url = `https://${req.get('host')}/dl/${id}`;
    // Create download handler
    rawDownloads[id] = {
        created: Date.now(),
        handler: async(req2, res2) => {
            // Handle the download
            await downloadSingleFileHandler(req.connectionOpts, res2, res.data.path, stats);
        }
    }
    res.sendData();
});
srv.get('/api/sftp/files/get/multi/url', async(req, res) => {
    try {
        // Get the normalized path and throw an error if it's missing
        res.data.paths = JSON.parse(req.query.paths);
        if (!res.data.paths) throw new Error('Missing path(s)');
    } catch (error) {
        return res.sendError(error);
    }
    // Generate download URL
    const id = Date.now();
    res.data.download_url = `https://${req.get('host')}/dl/${id}`;
    // Create download handler
    rawDownloads[id] = {
        created: Date.now(),
        handler: async(req2, res2) => {
            // Handle the download
            await downloadMultiFileHandler(req.connectionOpts, res2, res.data.paths, req.query.rootPath);
        }
    }
    res.sendData();
});
srv.get('/dl/:id', async(req, res) => {
    const handler = rawDownloads[req.params.id]?.handler;
    if (!handler) return res.status(404).end();
    handler(req, res);
});

srv.use((req, res) => res.status(404).end());

const port = 8261;
srv.listen(port, () => console.log(`Listening on port ${port}`));

setInterval(() => {
    // Delete inactive sessions
    for (const hash in sessions) {
        const lastActive = sessionActivity[hash];
        if (!lastActive) continue;
        if ((Date.now()-lastActive) > 1000*60) {
            console.log(`Deleting inactive session`);
            sessions[hash].end();
            delete sessions[hash];
            delete sessionActivity[hash];
        }
    }
    // Delete unused downloads
    for (const id in rawDownloads) {
        const download = rawDownloads[id];
        if ((Date.now()-download.created) > 1000*60*60) {
            console.log(`Deleting unused download`);
            delete rawDownloads[id];
        }
    }
}, 1000*30);