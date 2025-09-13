import {neon} from '@neondatabase/serverless'

const sql = neon(`${process.env.DATABSE_URL}`);

export default sql;

