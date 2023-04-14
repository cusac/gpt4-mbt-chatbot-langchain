import * as mammoth from 'mammoth';
import * as fs from 'fs/promises';
import * as path from 'path';

async function extractYouTubeLink(html: string) {
  const regex = /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[^"\s&']+/;
  const match = html.match(regex);
  return match ? match[0] : null;
}

async function processDocxFile(inputDocxPath: string) {
  try {
    const { value: html } = await mammoth.convertToHtml({
      path: inputDocxPath,
    });
    const youTubeLink = await extractYouTubeLink(html);

    if (youTubeLink) {
      const outputPath = path.join(
        path.dirname(inputDocxPath),
        `${path.basename(inputDocxPath, '.docx')}_yt_link.txt`,
      );
      await fs.writeFile(outputPath, youTubeLink);
      console.log(`YouTube link successfully written to: ${outputPath}`);
    } else {
      console.log(`No YouTube link found in the .docx file: ${inputDocxPath}`);
    }
  } catch (error) {
    console.error('Error processing .docx file:', error);
  }
}

async function processAllDocxFiles(directoryPath: string): Promise<void> {
  try {
    const files = await fs.readdir(directoryPath);
    const docxFiles = files.filter(file => path.extname(file) === '.docx');

    for (const docxFile of docxFiles) {
      const inputDocxPath = path.join(directoryPath, docxFile);
      const txtFilePath = path.join(
        directoryPath,
        `${path.basename(docxFile, '.docx')}_yt_link.txt`
      );

      try {
        await fs.access(txtFilePath);
        // console.log(`Matching .txt file already exists for: ${docxFile}`);
      } catch {
        await processDocxFile(inputDocxPath);
      }
    }
  } catch (error) {
    console.error('Error reading directory:', error);
  }
}

export const run = async () => {
  try {
    // Create an absolute path to the relative path of "docs/With Timestamps"
    const inputDirectoryPath = path.join(
      process.cwd(),
      'docs/With Timestamps',
    );
    console.log("PATH", inputDirectoryPath)
    await processAllDocxFiles(inputDirectoryPath);
  } catch (error) {
    console.log('error', error);
    throw new Error('Failed to extract links');
  }
};

(async () => {
  await run();
  console.log('extraction complete');
})();
