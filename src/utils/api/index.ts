import request from '../axios';

import FormData from 'form-data';

export async function sendToFile(
    filename: string,
    fileContent: Buffer
  ): Promise<{ status: number; data?: any }> {
    try {
      const payload = {
        name: filename,
        content: fileContent.toString('utf-8'), // 转为字符串
      };
  
      const response = await request.post('/upload', payload);
  
      return {
        status: response.status,
        data: response.data,
      };
    } catch (error) {
      console.error(`文件上传失败: ${filename}`, error);
      throw error;
    }
};

export const sendToFile2 = (data: any) => {
    return request({
        url: '/singFile',
        method: 'post',
        data,
    });
};