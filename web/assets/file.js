const elNavBar = $('#navbar');
const elControls = $('#controls');
const elPreview = $('#preview');
const btnDownload = $('#download');
const query = new URLSearchParams(window.location.search);
let path = query.get('path');
activeConnection = connections[query.get('con')];
let fileStats = null;
let editor;

function getLang(path) {
  const filename = path.split('/').pop();
  const parts = filename.split('.');
  if (parts.length === 1) return '';
  const ext = parts.pop().toLowerCase();
  const map = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    md: 'markdown',
  };
  return map[ext] || ext;
}

const updatePreview = async () => {
  // Make sure the file is viewable
  const extInfo = getFileExtInfo(path);
  if (!extInfo.isViewable) {
    return setStatus(`Error: File isn't viewable!`, true);
  }
  let fileUrl;
  try {
    const startTime = Date.now();
    let lastUpdate = 0;
    const blob = await api.request(
      'get',
      'files/get/single',
      {
        path: path,
      },
      null,
      (e) => {
        if (Date.now() - lastUpdate < 100) return;
        lastUpdate = Date.now();
        const progress = Math.round((e.loaded / fileStats.size) * 100);
        const bps = Math.round(e.loaded / ((Date.now() - startTime) / 1000));
        setStatus(
          `Downloaded ${formatSize(e.loaded)} of ${formatSize(fileStats.size)} (${formatSize(bps)}/s)`,
          false,
          progress,
        );
      },
      'blob',
    );
    fileUrl = URL.createObjectURL(blob);
  } catch (error) {
    return setStatus(`Error: ${error}`, true);
  }
  elPreview.classList.add(extInfo.type);
  const statusHtmlSegments = [];
  switch (extInfo.type) {
    case 'image': {
      const image = document.createElement('img');
      image.src = fileUrl;
      await new Promise((resolve) => {
        image.addEventListener('load', resolve);
      });
      elControls.insertAdjacentHTML(
        'beforeend',
        `
                <button class="zoomOut btn small secondary iconOnly" title="Zoom out">
                    <div class="icon">zoom_out</div>
                </button>
                <div class="zoom">0%</div>
                <button class="zoomIn btn small secondary iconOnly" title="Zoom in">
                    <div class="icon">zoom_in</div>
                </button>
                <div class="sep"></div>
                <button class="fit btn small secondary iconOnly" title="Fit">
                    <div class="icon">fit_screen</div>
                </button>
                <button class="real btn small secondary iconOnly" title="Actual size">
                    <div class="icon">fullscreen</div>
                </button>
            `,
      );
      const btnZoomOut = $('.btn.zoomOut', elControls);
      const btnZoomIn = $('.btn.zoomIn', elControls);
      const btnFit = $('.btn.fit', elControls);
      const btnReal = $('.btn.real', elControls);
      const elZoom = $('.zoom', elControls);
      let fitPercent = 100;
      const setZoom = (percent) => {
        const minZoom = fitPercent;
        const maxZoom = 1000;
        const newZoom = Math.min(Math.max(percent, minZoom), maxZoom);
        elZoom.innerText = `${Math.round(newZoom)}%`;
        const scaledSize = {
          width: image.naturalWidth * (newZoom / 100),
          height: image.naturalHeight * (newZoom / 100),
        };
        image.style.width = `${scaledSize.width}px`;
        image.style.height = `${scaledSize.height}px`;
      };
      const changeZoom = (percentChange) => {
        const zoom = parseInt(elZoom.innerText.replace('%', ''));
        setZoom(zoom + percentChange);
      };
      const fitImage = () => {
        const previewRect = elPreview.getBoundingClientRect();
        const previewRatio = previewRect.width / previewRect.height;
        const imageRatio = image.naturalWidth / image.naturalHeight;
        fitPercent = 100;
        if (imageRatio > previewRatio) {
          fitPercent = (previewRect.width / image.naturalWidth) * 100;
        } else {
          fitPercent = (previewRect.height / image.naturalHeight) * 100;
        }
        fitPercent = Math.min(fitPercent, 100);
        setZoom(fitPercent);
        image.style.marginTop = '';
        image.style.marginLeft = '';
      };
      btnZoomIn.addEventListener('click', () => {
        changeZoom(10);
      });
      btnZoomOut.addEventListener('click', () => {
        changeZoom(-10);
      });
      btnFit.addEventListener('click', () => {
        fitImage();
      });
      btnReal.addEventListener('click', () => {
        setZoom(100);
      });
      elPreview.addEventListener('wheel', (e) => {
        if (getIsMobileDevice()) return;
        e.preventDefault();
        const previewRect = elPreview.getBoundingClientRect();
        const relativePos = {
          x: e.clientX - previewRect.left + elPreview.scrollLeft,
          y: e.clientY - previewRect.top + elPreview.scrollTop,
        };
        const percentage = {
          x: relativePos.x / elPreview.scrollWidth,
          y: relativePos.y / elPreview.scrollHeight,
        };
        changeZoom(e.deltaY > 0 ? -10 : 10);
        const newScroll = {
          x: elPreview.scrollWidth * percentage.x - relativePos.x,
          y: elPreview.scrollHeight * percentage.y - relativePos.y,
        };
        elPreview.scrollLeft += newScroll.x;
        elPreview.scrollTop += newScroll.y;
      });
      /*
            let startTouchDistance = 0;
            elPreview.addEventListener('touchstart', e => {
                if (!getIsMobileDevice()) return;
                if (e.touches.length == 2) {
                    e.preventDefault();
                    const touch1 = e.touches[0];
                    const touch2 = e.touches[1];
                    const distance = Math.sqrt(
                        Math.pow(touch1.clientX - touch2.clientX, 2) +
                        Math.pow(touch1.clientY - touch2.clientY, 2)
                    );
                    startTouchDistance = distance;
                }
            });
            elPreview.addEventListener('touchmove', e => {
                if (!getIsMobileDevice()) return;
                if (e.touches.length == 2) {
                    e.preventDefault();
                    const touch1 = e.touches[0];
                    const touch2 = e.touches[1];
                    const distance = Math.sqrt(
                        Math.pow(touch1.clientX - touch2.clientX, 2) +
                        Math.pow(touch1.clientY - touch2.clientY, 2)
                    );
                    const percentChange = (distance - startTouchDistance) / 10;
                    changeZoom(percentChange);
                    startTouchDistance = distance;
                }
            });
            elPreview.addEventListener('touchend', e => {
                if (!getIsMobileDevice()) return;
                startTouchDistance = 0;
            });
            */
      let startCoords = {};
      let startScroll = {};
      let isMouseDown = false;
      elPreview.addEventListener('mousedown', (e) => {
        if (getIsMobileDevice()) return;
        e.preventDefault();
        startCoords = { x: e.clientX, y: e.clientY };
        startScroll = { x: elPreview.scrollLeft, y: elPreview.scrollTop };
        isMouseDown = true;
        elPreview.style.cursor = 'grabbing';
      });
      elPreview.addEventListener('dragstart', (e) => {
        if (getIsMobileDevice()) return;
        e.preventDefault();
      });
      elPreview.addEventListener('mousemove', (e) => {
        if (getIsMobileDevice()) return;
        e.preventDefault();
        if (!isMouseDown) return;
        const newScroll = {
          x: startCoords.x - e.clientX + startScroll.x,
          y: startCoords.y - e.clientY + startScroll.y,
        };
        // Update preview scroll
        elPreview.scrollLeft = newScroll.x;
        elPreview.scrollTop = newScroll.y;
      });
      elPreview.addEventListener('mouseup', (e) => {
        if (getIsMobileDevice()) return;
        e.preventDefault();
        isMouseDown = false;
        elPreview.style.cursor = '';
      });
      elPreview.addEventListener('mouseleave', (e) => {
        if (getIsMobileDevice()) return;
        e.preventDefault();
        isMouseDown = false;
        elPreview.style.cursor = '';
      });
      elControls.style.display = '';
      elPreview.innerHTML = '';
      elPreview.appendChild(image);
      statusHtmlSegments.push(
        `<span>${image.naturalWidth}x${image.naturalHeight}</span>`,
      );
      fitImage();
      window.addEventListener('resize', fitImage);
      break;
    }
    case 'video': {
      const video = document.createElement('video');
      video.src = fileUrl;
      await new Promise((resolve) => {
        video.addEventListener('loadedmetadata', resolve);
      });
      video.controls = true;
      elPreview.innerHTML = '';
      elPreview.appendChild(video);
      video.play();
      statusHtmlSegments.push(`<span>${formatSeconds(video.duration)}</span>`);
      statusHtmlSegments.push(
        `<span>${video.videoWidth}x${video.videoHeight}</span>`,
      );
      break;
    }
    case 'audio': {
      const audio = document.createElement('audio');
      audio.src = fileUrl;
      await new Promise((resolve) => {
        audio.addEventListener('loadedmetadata', resolve);
      });
      audio.controls = true;
      elPreview.innerHTML = '';
      elPreview.appendChild(audio);
      audio.play();
      statusHtmlSegments.push(`<span>${formatSeconds(audio.duration)}</span>`);
      break;
    }
    case 'markdown':
    case 'text': {
      const text = await (await fetch(fileUrl)).text();

      elPreview.innerHTML = '';
      const monacoContainer = document.createElement('div');
      monacoContainer.id = 'monaco-editor';
      monacoContainer.style.width = '100%';
      monacoContainer.style.height = '100%';
      elPreview.appendChild(monacoContainer);

      require.config({
        paths: {
          vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@latest/min/vs',
        },
      });
      require(['vs/editor/editor.main'], () => {
        monaco.editor.defineTheme('custom-vs-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': '#171d26',
          },
        });

        editor = monaco.editor.create(monacoContainer, {
          value: text,
          language: getLang(path),
          theme: 'custom-vs-dark',
          fontSize: 16,
          automaticLayout: true,
          scrollBeyondLastLine: false,
        });

        async function formatCode() {
          const code = editor.getValue();
          let lang = editor.getModel().getLanguageId();
          let parser = 'babel';
          if (lang === 'typescript') parser = 'typescript';
          else if (lang === 'html') parser = 'html';

          const formatted = await prettier.format(code, {
            parser,
            plugins: prettierPlugins,
            tabWidth: 2,
            singleQuote: true,
            semi: true,
          });

          editor.setValue(formatted);
        }

        window.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            formatCode();
          }
        });

        editor.onDidChangeModelContent(() => {
          btnSave.disabled = false;
          btnSave.classList.add('info');
          btnSaveText.innerText = 'Save';
        });

        btnSave.addEventListener('click', async () => {
          if (btnSave.disabled) return;
          btnSaveText.innerText = 'Saving...';
          btnSave.disabled = true;
          btnSave.classList.remove('info');
          const res1 = {};
          const res2 = await api.post(
            'files/create',
            {
              path: path,
            },
            editor.getValue(),
          );
          if (res1.error || res2.error) {
            setStatus(`Error: ${res2.error || res1.error}`, true);
            btnSaveText.innerText = 'Save';
            btnSave.disabled = false;
            btnSave.classList.add('info');
          } else {
            btnSaveText.innerText = 'Saved!';
            await getUpdatedStats();
            setStatusWithDetails();
          }
        });

        window.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.code === 'KeyS') {
            e.preventDefault();
            btnSave.click();
          }
        });
      });

      const btnSave = $('.btn.save', elControls);
      const btnSaveText = $('span', btnSave);
      const btnTextSmaller = $('.btn.textSmaller', elControls);
      const btnTextBigger = $('.btn.textBigger', elControls);
      const elTextSize = $('.textSize', elControls);
      let size = parseInt(window.localStorage.getItem('textEditorSize')) || 16;

      const updateTextSize = () => {
        editor.updateOptions({ fontSize: size });
        elTextSize.innerText = size;
        window.localStorage.setItem('textEditorSize', size);
      };

      btnTextSmaller.addEventListener('click', () => {
        size--;
        updateTextSize();
      });
      btnTextBigger.addEventListener('click', () => {
        size++;
        updateTextSize();
      });

      elControls.style.display = '';
      break;
    }
    default: {
      elPreview.innerHTML = `<h1 class="text-danger">Error!</h1>`;
      break;
    }
  }
  const setStatusWithDetails = () => {
    setStatus(`
            <div class="row flex-wrap" style="gap: 2px 20px">
                <span>${formatSize(fileStats.size)}</span>
                ${statusHtmlSegments.join('\n')}
                <span>${extInfo.mime}</span>
                <span>${getRelativeDate(fileStats.modifyTime)}</span>
            </div>
        `);
  };
  setStatusWithDetails();
  setTimeout(setStatusWithDetails, 60 * 1000);
};

const getUpdatedStats = async () => {
  // Stat file
  const res = await api.get('files/stat', {
    path: path,
  });
  fileStats = res.stats;
  return res;
};

window.addEventListener('load', async () => {
  const res = await getUpdatedStats();
  if (!res.error) {
    // Update navbar
    path = res.path;
    document.title = `${path}`;
    const pathSplit = path.split('/');
    const folderPath = `${pathSplit.slice(0, pathSplit.length - 1).join('/')}/`;
    const fileName = pathSplit[pathSplit.length - 1];
    $('.path', elNavBar).innerText = folderPath;
    $('.name', elNavBar).innerText = fileName;
    updatePreview(fileName);
  } else {
    return setStatus(`Error: ${res.error}`, true);
  }
});

btnDownload.addEventListener('click', async () => {
  const fileName = $('.name', elNavBar).innerText;
  const elSrc = $('img, video, audio', elPreview);
  const elText = $('textarea', elPreview);
  if (elSrc) {
    console.log(`Starting download using downloaded blob`);
    return downloadUrl(elSrc.src, fileName);
  } else if (elText && editor) {
    console.log(`Starting download using text editor value`);
    const value = editor.getValue();
    const dataUrl = `data:text/plain;base64,${btoa(value)}`;
    return downloadUrl(dataUrl, fileName);
  } else {
    console.log(`Starting download using URL API`);
    const url = await getFileDownloadUrl(path);
    downloadUrl(url);
  }
});

// Let the window finish displaying itself before saving size
setTimeout(() => {
  window.addEventListener('resize', () => {
    window.localStorage.setItem('viewerWidth', window.innerWidth);
    window.localStorage.setItem('viewerHeight', window.innerHeight);
  });
}, 2000);
