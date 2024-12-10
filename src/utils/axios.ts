import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Axios instance for API requests
const request: AxiosInstance = axios.create({
  baseURL: 'http://gpt.livstyle.cn/api', // Replace with your 
  timeout: 120000, // Timeout in milliseconds
  headers: {
    'Content-Type': 'application/json'
  }
});


request.interceptors.response.use(
    (response) => response,
    (error) => {
      console.error('请求失败:', error.message);
      return Promise.reject(error.response?.data || error.message);
    }
  );
  
export default request;
