const express = require('express');
const session = require('express-session');
const redis = require('redis');
const connectRedis = require('connect-redis');
const mysql = require('mysql2');
var bodyParser = require('body-parser');
const amqp = require('amqplib/callback_api');
const mongoose = require('mongoose');
const Comment = require('./models/commentModel');




require('dotenv').config();


const app = express();
const RedisStore = connectRedis(session);

app.set('trust proxy', 1);


app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const SESSION_SECRET = process.env.SESSION_SECRET;
const PORT = process.env.PORT;
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_DATABASE = process.env.DB_DATABASE;
const REDIS_HOST = process.env.REDIS_HOST;
const COOKIE_NAME = process.env.COOKIE_NAME;

mongoose.connect('mongodb://mongodb:27017')
.then(() => {
  console.log("MongoDB'ye bağlanıldı");
})
.catch((err) => {
  console.error("MongoDB bağlantı hatası:", err);
});

//mongodb+srv://admin:pass@devopsacademy.ljt9h41.mongodb.net/comments?retryWrites=true&w=majority&appName=DevOpsAcademy
// MongoDB bağlantısı


//session server tarafında bir databasede saklanacak bunun için anahtar değer şeklinde saklayan redis kullanılır.
const redisClient = redis.createClient({
    host: REDIS_HOST,
    port: "6379"
    //url: "redis://172.20.0.2:6379"
});

const mysqlConnection = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_DATABASE
  });

const rabbitmqSettings = {
    protocol: 'amqp',
    hostname: '10.103.196.64',
    port: 5672,
    username: 'guest',
    password: 'guest',
    vhost: '/',
    authMechanism: ['PLAIN','AMQPLAIN','EXTERNAL']
};

redisClient.on('error', function (err) {
    console.log('Could not establish a connection with redis. ' + err);
});
redisClient.on('connect', function (err) {
    console.log('Connected to redis successfully');
});


app.use(session({
    name: COOKIE_NAME,
    store: new RedisStore({ client: redisClient }), //servera bağlanacak client yukarıda 
    secret: SESSION_SECRET, //require("crypto").randomBytes(64).toString("hex");
    resave: false, //kullanıcı session üzerinde değişiklik yapmasa bile kaydeder bu yüzden race condition oluşabilir. o yüzden false
    saveUninitialized: false, //uninitialize session session üzerinde değişiklik yapılmadıysa kaydedilmez.
    cookie: {
        secure: false, //http // true https production olduğu için http://localhost:3000 için cookieleri kullanamayız o yüzden false
        httpOnly: false, //unreachable with cross side scripting 
        maxAge: 1000 * 60 * 60 * 24    }
}));



app.post("/register", (req, res) => {
    try {
        const { username, password } = req.body;
        
        // MySQL sorgusu ile kullanıcıyı veritabanında arayın
        const query = "INSERT INTO users (username, password) VALUES (?, ?)";
        mysqlConnection.query(query, [username, password], (error, results, fields) => {
            if (error) {
                console.error(error);
                return res.status(500).json({ error: "Database error" });
            }
            
            return res.status(200).json({ message: "User registration created successfully" });
        });
    } catch (error) {
        console.error(error);
        return res.status(400).json({ error: "Error" });
    }
});


app.post("/login",async (req, res)=>{
    
        const {username, password} =req.body;
        mysqlConnection.query(
            'SELECT * FROM users WHERE username = ? AND password = ?',
            [username, password],
            async (err, results) => {
                if (err) {
                    console.error('Error authenticating user:', err);
                    return res.status(500).json({ error: 'An error occurred while authenticating user' });
                }
                if (results.length === 0) {
                    return res.status(401).json({ error: 'Invalid username or password' });
                }
              
                const user = {username, password};
                const userId = results[0].user_id;
                req.session.userId = userId;
                req.session.user = user;
                return res.status(200).json({ message: 'Login successful', user });})
    
});



  app.get('/get-products', (req, res) => {
    mysqlConnection.query('SELECT * FROM products', (error, rows, fields) => {
        if (error) {
            console.error('Error fetching products:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        res.status(200).json(rows);
    });
});


app.post('/add-product', async (req, res) => {
    const { name, price, stock } = req.body;
    if (!name || !price || !stock) {
        return res.status(400).json({ error: 'Name, price, and stock are required' });
    }
    try {
         mysqlConnection.query('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', [name, price, stock]);
        res.status(201).json({ message: 'Product added successfully' });
    } catch (error) {
        console.error('Error adding product:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/delete-products/:id', async (req, res) => {
    const productId = req.params.id;

    try {
        mysqlConnection.query('DELETE FROM products WHERE id = ?', [productId], (error, result) => {
            if (error) {
                console.error('Error deleting product:', error);
                return res.status(500).json({ error: 'Internal Server Error' });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Product not found' });
            }

            res.status(200).json({ message: 'Product deleted successfully' });
        });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.post('/place-order', (req, res) => {
    try {
        
        if (!req.session) {
            return res.status(401).json({ error: 'Unauthorized: You need to log in to place an order' });
        }

        
        const { productId, quantity } = req.body;
        const userId = req.session.userId;

        const order = { userId, productId, quantity };

       
        amqp.connect(rabbitmqSettings, (error0, connection) => {
            if (error0) {
                throw error0;
            }
            connection.createChannel((error1, channel) => {
                if (error1) {
                    throw error1;
                }
                const queue = 'order_queue';
                const msg = JSON.stringify(order);

                channel.sendToQueue(queue, Buffer.from(msg), {
                    persistent: true
                });

                console.log('Sent order to RabbitMQ:', order);
            });

            setTimeout(() => {
                connection.close();
            }, 500);
        });

      
        saveOrderToMySQL(order, userId);

        updateProductStockInMySQL(order.productId, order.quantity);

        updateCartOnRedis(order.userId, order.productId, order.quantity);

        res.status(200).json({ message: 'Order placed successfully' });
    } catch (error) {
        console.error('Error placing order:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.post('/products/:productId/comments', async (req, res) => {
    try {
        const { productId } = req.params;
        const { userId } = req.session.userId;
        const { content, rating } = req.body;

        const comment = await Comment.create({
            content: content,
            rating: rating,
            userID: userId,
            productID: productId // id, yol parametresinden geliyor
        });


        res.status(201).json({ message: 'Yorum başarıyla eklendi.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Yorum eklenirken bir hata oluştu.' });
    }
});




app.listen(PORT,()=>{
    console.log("Server is running on port 3000");
});


function saveOrderToMySQL(order, userId) {
    const { productId, quantity } = order;
    const query = 'INSERT INTO orders (user_id, product_id, quantity) VALUES (?, ?, ?)';
    mysqlConnection.query(query, [userId, productId, quantity], (error, results, fields) => {
        if (error) {
            console.error('Error saving order to MySQL:', error);
        }
        console.log('Order inserted to database');
    });
}



function updateProductStockInMySQL(productId, quantity) {
    const query = 'UPDATE products SET stock = stock - ? WHERE product_id = ?';
    mysqlConnection.query(query, [quantity, productId], (error, results, fields) => {
        if (error) {
            console.error('Error updating product stock in MySQL:', error);
        }
        console.log('Order updated on database');
    });
}


function updateCartOnRedis(userId, productId, quantity) {
    redisClient.hincrby(`cart:${userId}`, productId, quantity, (error, result) => {
        if (error) {
            console.error('Error updating cart on Redis:', error);
        }
        console.log('Cart on redis updated');
    });
}