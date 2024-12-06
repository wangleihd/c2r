import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

// Axios instance for API requests
const request: AxiosInstance = axios.create({
  baseURL: 'http://http://127.0.0.1:8000', // Replace with your API base URL
  timeout: 10000, // Timeout in milliseconds
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
