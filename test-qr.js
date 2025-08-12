const qrcode = require('qrcode');

async function testQR() {
  const testQR = '2@test123';
  
  try {
    const qrDataURL = await qrcode.toDataURL(testQR, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    console.log('QR Code Data URL generated successfully!');
    console.log('Length:', qrDataURL.length);
    console.log('Starts with:', qrDataURL.substring(0, 50));
  } catch (error) {
    console.error('Error:', error);
  }
}

testQR();
