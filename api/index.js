import express from 'express'
import bodyParser from 'body-parser';
import webhookRouter from './routes/webhookRoute.js';

const app = express();
app.use(bodyParser.json());

app.use('/api/moralis/webhook', webhookRouter);

app.listen(process.env.PORT || 3000, () => {
    console.log('Server is running on port 3000');
});