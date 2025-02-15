import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describeUserPage } from '@/ai-model';
import { base64Encoded, imageInfoOfBase64 } from '@/image';

type TestCase = {
  prompt: string;
  response: Array<{ id: string; indexId: number }>;
  expected?: boolean;
};

export type InspectAiTestCase = {
  testDataPath: string;
  testCases: Array<TestCase>;
};

export interface AiElementsResponse {
  elements: Array<
    | {
        id: string;
        reason: string;
        text: string;
      }
    | {
        position: {
          x: number;
          y: number;
        };
        reason: string;
        text: string;
      }
  >;
}

export interface TextAiElementResponse extends AiElementsResponse {
  response: Array<
    | {
        id: string;
      }
    | {
        position: {
          x: number;
          y: number;
        };
      }
  >;
  // for test
  caseIndex?: number;
  prompt: string;
  error?: string;
  spendTime: number;
  elementsSnapshot: Array<any>;
}

export async function runTestCases(
  testCases: Array<TestCase>,
  context: any,
  getAiResponse: (options: {
    description: string;
  }) => Promise<AiElementsResponse>,
) {
  let aiResponse: Array<TextAiElementResponse> = [];
  const { content: elementSnapshot } = context;

  const aiReq = testCases.map(async (testCase, caseIndex) => {
    const startTime = Date.now();
    const msg = await getAiResponse({
      description: testCase.prompt,
    });
    const endTime = Date.now();
    const spendTime = endTime - startTime;
    if (msg.elements) {
      aiResponse.push({
        ...msg,
        prompt: testCase.prompt,
        response: msg.elements,
        caseIndex,
        spendTime,
        elementsSnapshot: msg.elements.map((element) => {
          const index = elementSnapshot.findIndex((item: any) => {
            if ('id' in element && item.nodeHashId === element.id) {
              return true;
            }
          });
          return elementSnapshot[index];
        }),
      });
    } else {
      aiResponse.push({
        error: `can't find element with description: ${testCase.prompt}`,
      } as any);
    }
  });
  await Promise.all(aiReq);
  aiResponse = aiResponse.sort((a, b) => {
    if (a.caseIndex !== undefined && b.caseIndex !== undefined) {
      return a.caseIndex - b.caseIndex;
    }
    return -1;
  });

  aiResponse.forEach((item) => {
    if ('caseIndex' in item) {
      item.caseIndex = undefined;
    }
  });

  const filterUnstableResult = aiResponse.map((aiInfo) => {
    const { elements = [], prompt, error = [], elementsSnapshot } = aiInfo;
    return {
      elements: elements.map((element, index) => {
        return {
          id: 'id' in element ? element.id.toString() : '',
          indexId: elementsSnapshot[index]?.indexId,
        };
      }),
      error,
      prompt,
    };
  });

  return {
    aiResponse,
    filterUnstableResult,
  };
}

export const repeat = (times: number, fn: (index: number) => void) => {
  for (let i = 1; i <= times; i++) {
    fn(i);
  }
};

export const repeatFile = (
  files: Array<string>,
  times: number,
  fn: (file: string, index: number) => void,
) => {
  for (const file of files) {
    repeat(times, (index) => {
      fn(file, index);
    });
  }
};

function ensureDirectoryExistence(filePath: string) {
  const dirname = path.dirname(filePath);
  if (existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  mkdirSync(dirname);
}

type WriteFileSyncParams = Parameters<typeof writeFileSync>;

export function writeFileSyncWithDir(
  filePath: string,
  content: WriteFileSyncParams[1],
  options: WriteFileSyncParams[2] = {},
) {
  ensureDirectoryExistence(filePath);
  writeFileSync(filePath, content, options);
}

export async function getPageTestData(targetDir: string): Promise<{
  context: {
    size: {
      width: number;
      height: number;
    };
    content: any;
    tree: any;
    screenshotBase64: string;
    originalScreenshotBase64: string;
    describer: () => Promise<any>;
  };
  snapshotJson: string;
  screenshotBase64: string;
  originalScreenshotBase64: string;
}> {
  // Note: this is the magic
  const resizeOutputImgP = path.join(targetDir, 'output_without_text.png');
  const originalInputImgP = path.join(targetDir, 'input.png');
  const snapshotJsonPath = path.join(targetDir, 'element-snapshot.json');
  const elementTreeJsonPath = path.join(targetDir, 'element-tree.json');
  const snapshotJson = readFileSync(snapshotJsonPath, { encoding: 'utf-8' });
  const elementSnapshot = JSON.parse(snapshotJson);
  const elementTree = JSON.parse(
    readFileSync(elementTreeJsonPath, { encoding: 'utf-8' }),
  );
  const screenshotBase64 = base64Encoded(resizeOutputImgP);
  const originalScreenshotBase64 = base64Encoded(originalInputImgP);
  const size = await imageInfoOfBase64(screenshotBase64);
  const baseContext = {
    size,
    content: elementSnapshot,
    tree: elementTree,
    screenshotBase64,
    originalScreenshotBase64,
  };

  return {
    context: {
      ...baseContext,
      describer: async () => {
        return describeUserPage(baseContext);
      },
    },
    snapshotJson,
    screenshotBase64,
    originalScreenshotBase64,
  };
}

export async function getPageDataOfTestName(testName: string) {
  const targetDir = path.join(__dirname, `../test-data/${testName}`);
  return await getPageTestData(targetDir);
}
