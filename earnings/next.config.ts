import type {NextConfig} from 'next';
const config:NextConfig={output:'export',basePath:'/earnings-tracker',trailingSlash:true,images:{unoptimized:true},experimental:{cpus:1}};
export default config;
