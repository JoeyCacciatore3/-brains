/**
 * Web Worker for encoding files to base64
 * Prevents UI blocking during large file encoding
 */

// Listen for file encoding requests
self.addEventListener('message', async (event) => {
  const { file, fileIndex, totalFiles } = event.data;

  try {
    // Validate file
    if (!file) {
      throw new Error('File is null or undefined');
    }

    if (file.size === 0) {
      throw new Error('File is empty');
    }

    // Send progress update: starting
    self.postMessage({
      type: 'progress',
      fileIndex,
      totalFiles,
      progress: 0,
      fileName: file.name,
    });

    // Read file as data URL (base64)
    const reader = new FileReader();

    reader.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        self.postMessage({
          type: 'progress',
          fileIndex,
          totalFiles,
          progress,
          fileName: file.name,
        });
      }
    };

    reader.onload = () => {
      try {
        const result = reader.result;
        if (!result || typeof result !== 'string') {
          throw new Error('Failed to read file: invalid result');
        }

        const parts = result.split(',');
        if (parts.length < 2) {
          throw new Error('Failed to parse file data');
        }

        const base64 = parts[1];
        if (!base64 || base64.length === 0) {
          throw new Error('Empty base64 data');
        }

        // Send success with base64 data
        self.postMessage({
          type: 'success',
          fileIndex,
          totalFiles,
          fileName: file.name,
          base64,
          fileType: file.type,
          fileSize: file.size,
        });
      } catch (error) {
        self.postMessage({
          type: 'error',
          fileIndex,
          totalFiles,
          fileName: file.name,
          error: error instanceof Error ? error.message : 'Failed to process file data',
        });
      }
    };

    reader.onerror = () => {
      self.postMessage({
        type: 'error',
        fileIndex,
        totalFiles,
        fileName: file.name,
        error: `File read error: ${reader.error?.message || 'Unknown error'}`,
      });
    };

    reader.onabort = () => {
      self.postMessage({
        type: 'error',
        fileIndex,
        totalFiles,
        fileName: file.name,
        error: 'File read was aborted',
      });
    };

    // Start reading the file
    reader.readAsDataURL(file);
  } catch (error) {
    self.postMessage({
      type: 'error',
      fileIndex,
      totalFiles,
      fileName: file?.name || 'unknown',
      error: error instanceof Error ? error.message : 'Failed to start file read',
    });
  }
});
