const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');

const app = express();
app.use(bodyParser.json());

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', //пароль от юзера root
    database: 'umag_hacknu'
});

connection.connect((err) => {
    if (err) {
        console.error('Ошибка при присоединении к MYSQL:', err);
        process.exit(1);
    }
    console.log('Подключено к базе MYSQL');
});

const mainQueue = {};

function costRecalculation(barcode, quantity, price, operation) {
    if (!mainQueue[barcode]) {
        mainQueue[barcode] = [];
    }
    
    const queue = mainQueue[barcode];
    
    if (operation === 'sale') {
        let trueCost = 0;
        let remaining = quantity;
        
        while (remaining > 0 && queue.length > 0) {
            const supply = queue[0];
            const usedQuantity = Math.min(remaining, supply.quantity);
        
            trueCost += usedQuantity * supply.price;
            remaining -= usedQuantity;
            supply.quantity -= usedQuantity;
        
            if (supply.quantity === 0) {
                queue.shift();
            }
        }
        
        return trueCost;
    } else if (operation === 'supply') {
        queue.push({ quantity, price });
        return null;
    } else if (operation === 'revert_sale') {
        const supplyIndex = queue.findIndex(supply => supply.price === price);
            
        if (supplyIndex !== -1) {
            queue[supplyIndex].quantity += quantity;
        } else {
            queue.push({ quantity, price });
            queue.sort((a, b) => a.price - b.price);
        }
    }
    return null;
}
  

app.get('/api/supplies', (req, res) => {
    const { fromTime, toTime, barcode } = req.query;

    let query = 'SELECT * FROM supply';
    const queryParams = [];
    const conditions = [];
  
    if (fromTime) {
        conditions.push('supply_time >= ?');
        queryParams.push(fromTime);
    }
  
    if (toTime) {
        conditions.push('supply_time <= ?');
        queryParams.push(toTime);
    }
  
    if (barcode) {
        conditions.push('barcode = ?');
        queryParams.push(barcode);
    }
  
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
  
    connection.query(query, queryParams, (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в получении закупок');
        } else {
            res.json(results);
        }
    });
});

app.post('/api/supplies', (req, res) => {
    const { barcode, price, quantity, supplyTime } = req.body;
  
    const query = `
      INSERT INTO supply (barcode, price, quantity, supply_time)
      VALUES (?, ?, ?, ?)`;
  
    connection.query(query, [barcode, price, quantity, supplyTime], (err, result) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в создании закупки');
        } else {
            costRecalculation(barcode, quantity, price, 'supply');
            res.json({ id: result.insertId });
        }
    });
});

app.put('/api/supplies/:supplyId', (req, res) => {
    const supplyId = parseInt(req.params.supplyId);
    const { barcode, price, quantity, supplyTime } = req.body;
  
    const query = `
      UPDATE supply
      SET barcode = ?, price = ?, quantity = ?, supply_time = ?
      WHERE id = ?
    `;
  
    connection.query(query, [barcode, price, quantity, supplyTime, supplyId], (err, result) => {
      if (err) {
        console.error(err);
        res.status(500).send('Ошибка в обновлении закупки');
      } else if (result.affectedRows === 0) {
        res.status(404).send('Закупка не найдена');
      } else {
        res.sendStatus(200);
      }
    });
});
  
app.delete('/api/supplies/:supplyId', (req, res) => {
    const supplyId = parseInt(req.params.supplyId);
  
    const query = `
      DELETE FROM supply
      WHERE id = ?`;
  
    connection.query(query, [supplyId], (err, result) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в удалении закупки');
        } else if (result.affectedRows === 0) {
            res.status(404).send('Закупка не найдена');
        } else {
            res.sendStatus(200);
        }
    });
});

app.get('/api/supplies/:supplyId', (req, res) => {
    const supplyId = parseInt(req.params.supplyId);
  
    const query = 'SELECT * FROM supply WHERE id = ?';
  
    connection.query(query, [supplyId], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в получении закупки');
        } else if (results.length === 0) {
            res.status(404).send('Закупка не найдена');
        } else {
            res.json(results[0]);
        }
    });
});

app.get('/api/sales', (req, res) => {
    const { fromTime, toTime, barcode } = req.query;
    let query = 'SELECT * FROM sale';
    const queryParams = [];
    const conditions = [];
  
    if (fromTime) {
        conditions.push('sale_time >= ?');
        queryParams.push(fromTime);
    }
  
    if (toTime) {
        conditions.push('sale_time <= ?');
        queryParams.push(toTime);
    }
  
    if (barcode) {
        conditions.push('barcode = ?');
        queryParams.push(barcode);
    }
  
    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }
  
    connection.query(query, queryParams, (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в получении продаж');
        } else {
            res.json(results);
        }
    });
});


app.post('/api/sales', (req, res) => {
    const { barcode, price, quantity, saleTime } = req.body;
  
    const margin = costRecalculation(barcode, quantity, null, 'sale');
  
    if (margin === null) {
        res.status(400).send('Не хватает продуктов для продажи');
        return;
    }
  
    const query = `
      INSERT INTO sale (barcode, price, quantity, sale_time, margin)
      VALUES (?, ?, ?, ?, ?)`;
  
    connection.query(query, [barcode, price, quantity, saleTime, margin], (err, result) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в создании продажи');
        } else {
            res.json({ id: result.insertId });
        }
    });
});
  
app.put('/api/sales/:saleId', (req, res) => {
    const saleId = parseInt(req.params.saleId);
    const { barcode, price, quantity, saleTime } = req.body;
  
    connection.query('SELECT * FROM sale WHERE id = ?', [saleId], (err, saleResults) => {
        if (err || saleResults.length === 0) {
            res.status(404).send('Продажа не найдена');
            return;
        }
    
        const oldSale = saleResults[0];
        costRecalculation(barcode, oldSale.quantity, oldSale.price, 'revert_sale');
    
        const margin = costRecalculation(barcode, quantity, null, 'sale');
        if (margin === null) {
            res.status(400).send('Не хватает продуктов для продажи');
            return;
        }
    
        const query = `
            UPDATE sale
            SET barcode = ?, price = ?, quantity = ?, sale_time = ?, margin = ?
            WHERE id = ?`;
    
        connection.query(query, [barcode, price, quantity, saleTime, margin, saleId], (err, result) => {
            if (err) {
                console.error(err);
                res.status(500).send('Ошибка в обновлении продажи');
            } else if (result.affectedRows === 0) {
                res.status(404).send('Продажа не найдена');
            } else {
                res.sendStatus(200);
            }
        });
    });
});
  
app.delete('/api/sales/:saleId', (req, res) => {
    const saleId = parseInt(req.params.saleId);
  
    const query = `
      DELETE FROM sale
      WHERE id = ?`;
  
    connection.query(query, [saleId], (err, result) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в удалении продажи');
        } else if (result.affectedRows === 0) {
            res.status(404).send('Продажа не найдена');
        } else {
            res.sendStatus(200);
        }
    });
});

app.get('/api/sales/:saleId', (req, res) => {
    const saleId = parseInt(req.params.saleId);
  
    const query = 'SELECT * FROM sale WHERE id = ?';
    
    connection.query(query, [saleId], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в получении продаж');
        } else if (results.length === 0) {
            res.status(404).send('Продажа не найдена');
        } else {
            res.json(results[0]);
        }
    });
});

app.get('/api/reports', (req, res) => {
    const { fromTime, toTime, barcode } = req.query;
  
    const query = `
      SELECT barcode, SUM(quantity) as quantity, SUM(price * quantity) as revenue, SUM(margin) as netProfit
      FROM sale
      WHERE sale_time BETWEEN ? AND ? AND barcode = ?
      GROUP BY barcode
    `;
  
    connection.query(query, [fromTime, toTime, barcode], (err, results) => {
        if (err) {
            console.error(err);
            res.status(500).send('Ошибка в получении отчета');
        } else if (results.length === 0) {
            res.status(404).send('Не найдено информации на данный период и штрихкод');
        } else {
            const reportData = {
                barcode: results[0].barcode,
                quantity: results[0].quantity,
                revenue: results[0].revenue,
                netProfit: results[0].netProfit,
            };
            res.json(reportData);
        }
    });
});
  

app.on('close', () => {
    connection.end();
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
    console.log(`Сервер работает на порту ${port}`);
});
