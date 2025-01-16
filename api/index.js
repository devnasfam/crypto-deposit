import express from 'express'
import bodyParser from 'body-parser';
import webhookRouter from './routes/webhookRoute.js';
import generateRouter from './routes/generateRoute.js';
import cors from 'cors';
import { checkAuth } from './middlewares/checkAuth.js';
import { verifyAppCheckToken } from './middlewares/verifyAppCheck.js';
import { verifySignature } from './middlewares/verifyWebhook.js';

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use('/api/moralis/webhook', verifySignature, webhookRouter);
app.use('/api/generate/address', verifyAppCheckToken, checkAuth, generateRouter);

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running on port 3000');
});