const XLSX = require('xlsx');

const rawData = [
  ["MJM-MOTO-WP360", "MJM Rainproof Motorcycle Mobile Holder 360° Rotatable Phone Mount with 270° Adjustable Arm | Rain Water Protection | For Navigation, GPS & Delivery Riders", "Unique Motorcycle Mobile Holders", 0],
  ["MJM-JAPNAM-4", "MJM Digital Electronic Mini Finger Ring Head Hand Tally Japa Counter, For Various Counting Purpose, Tally counter, Pack of 4", "Fancy Cricket Umpire Counters", 1000],
  ["MJM-IPACKY-SAMA16-5G-BLK-TG-001", "MJM Hard Transparent Anti Yellow Back Cover with 9H Tempered Glass 2 in 1 Combo for Samsung Galaxy A16 5G | Shockproof Clear Back Case | Camera Protection", "Samsung Galaxy A16 5G Cases & Covers", 1000],
  ["MJM-R1S-LONG-BLK-001", "MJM 170CM Selfie Stick Tripod with Bluetooth Remote | 3 in 1 Foldable Mobile Stand | Adjustable Phone Holder for Android & iPhone | Selfie, Reels, Vlogging & Video Recording", "New Collections Of Selfie Stick", 94],
  ["MJM-OU-TG-SAMA16-001", "MJM Soft Transparent TPU Back Cover with 9H Tempered Glass Combo for Samsung Galaxy A16 5G | Crystal Clear Shockproof Slim Protective Case", "Samsung Galaxy A16 5G Cases & Covers", 499],
  ["MJM-TJ-SAMA16-BLK-001", "MJM Cute Tom & Jerry Printed Soft TPU Back Cover with 9H Tempered Glass for Samsung Galaxy A16 5G | Shockproof Designer Case | Camera Protection | Black", "Samsung Galaxy A16 5G Cases & Covers", 10],
  ["MJM-TJ-SAMA16-BRN-001", "MJM Cute Tom & Jerry Printed Soft TPU Back Cover with 9H Tempered Glass for Samsung Galaxy A16 5G | Shockproof Designer Case | Camera Protection | Brown", "Samsung Galaxy A16 5G Cases & Covers", 9],
  ["MJM-TJ-SAMA16-GRN-001", "MJM Cute Tom & Jerry Printed Soft TPU Back Cover with 9H Tempered Glass for Samsung Galaxy A16 5G | Shockproof Designer Case | Camera Protection | Green", "Samsung Galaxy A16 5G Cases & Covers", 9],
  ["MJM-TJ-SAMA16-MRN-001", "MJM Cute Tom & Jerry Printed Soft TPU Back Cover with 9H Tempered Glass for Samsung Galaxy A16 5G | Shockproof Designer Case | Camera Protection | Maroon", "Samsung Galaxy A16 5G Cases & Covers", 10],
  ["MJM-3IN1-TDY-BLK-1PC", "MJM 100W 3 in 1 Fast Charging Cable with LED Light | Type C + Lightning + Micro USB | Nylon Braided USB Charging Cable | Black | 1 Piece", "Cables", 0],
  ["MJM-OU-TG-V20-001", "MJM Transparent Back Cover with 9H Tempered Glass Combo for Vivo Y20 | Shockproof Clear Case", "Vivo Y20 Cases & Covers", 500],
  ["MJM-OU-TG-V20A-001", "MJM Transparent Back Cover with 9H Tempered Glass Combo for Vivo Y20A | Shockproof Clear Case", "Vivo Y20 Cases & Covers", 500],
  ["MJM-OU-TG-V20G-001", "MJM Transparent Back Cover with 9H Tempered Glass Combo for Vivo Y20G | Shockproof Clear Case", "Vivo Y20 Cases & Covers", 500],
  ["MJM-P47-WIRELESS-BLK-001", "MJM P47 Wireless Bluetooth On Ear Headphone with Mic Extra Bass | Foldable Stereo Headset for Gaming, Music, Calling | Black", "Bluetooth Headphones & Earphones", 100],
  ["MJM-P47-WIRELESS-BLU-001", "MJM P47 Wireless Bluetooth On Ear Headphone with Mic Extra Bass | Foldable Stereo Headset for Gaming, Music, Calling | Blue", "Bluetooth Headphones & Earphones", 100],
  ["MJM-P47-WIRELESS-RED-001", "MJM P47 Wireless Bluetooth On Ear Headphone with Mic Extra Bass | Foldable Stereo Headset for Gaming, Music, Calling | Red", "Bluetooth Headphones & Earphones", 100],
  ["MJM-P47-WIRELESS-WHT-001", "MJM P47 Wireless Bluetooth On Ear Headphone with Mic Extra Bass | Foldable Stereo Headset for Gaming, Music, Calling | White", "Bluetooth Headphones & Earphones", 100],
  ["MJM-P47-WIRELESS-GRN-001", "MJM P47 Wireless Bluetooth On Ear Headphone with Mic Extra Bass | Foldable Stereo Headset for Gaming, Music, Calling | Green", "Bluetooth Headphones & Earphones", 100],
  ["MJM-P47-WIRELESS-BLK-002", "MJM P47 Wireless Bluetooth Headphones with Mic Extra Bass Pack of 2 | Black", "Bluetooth Headphones & Earphones", 50],
  ["MJM-3IN1-CABLE-120W-1M-BLACK-001", "MJM 3 In 1 Fast Charging Cable 120W Super Charge USB Cable with Type C, Micro USB & 8 Pin Connector 1 Meter | Black", "Cables", 98],
  ["MJM-3IN1-CABLE-120W-1M-BLUE-01", "MJM 3 In 1 Fast Charging Cable 120W Super Charge USB Cable with Type C, Micro USB & 8 Pin Connector 1 Meter | Blue", "Cables", 2],
  ["MJM-3IN1-CABLE-120W-1M-ORANGE-001", "MJM 3 In 1 Fast Charging Cable 120W Super Charge USB Cable with Type C, Micro USB & 8 Pin Connector 1 Meter | Orange", "Cables", 3],
  ["MJM-3IN1-CABLE-120W-1M-BLACK-01", "MJM 3 In 1 Black Fast Charging Cable 120W Super Charge USB Cable with Type C, Micro USB & 8 Pin Connector 1 Meter", "Cables", 0],
  ["MJM-P9-MAX-HEADPHONE-SILVER", "MJM P9 Max Wireless Bluetooth Over-Ear Headphones with Spatial Audio, Active Noise Cancellation & Deep Bass - Silver", "Bluetooth Headphones & Earphones", 15],
  ["MJM-AIRDOPES-PRIME-GREEN", "MJM Airdopes Prime TWS Earbuds Bluetooth 5.4 Wireless Earbuds with Deep Bass, HD Calling, Type-C Charging & 18 Hours Playback - Green", "Bluetooth Headphones & Earphones", 0],
  ["MJM-AIRDOPES-PRIME-BLUE", "MJM Airdopes Prime TWS Earbuds Bluetooth 5.4 Wireless Earbuds with Deep Bass, HD Calling, Type-C Charging & 18 Hours Playback - Blue", "Bluetooth Headphones & Earphones", 0],
  ["MJM-AIRDOPES-PRIME-BLACK", "MJM Airdopes Prime TWS Earbuds Bluetooth 5.4 Wireless Earbuds with Deep Bass, HD Calling, Type-C Charging & 18 Hours Playback - Black", "Bluetooth Headphones & Earphones", 0],
  ["MJM-OU-TG-TECNO-SPARK-20-001", "MJM Soft Transparent TPU Back Cover with 9H Tempered Glass Combo for Tecno Spark 20", "Tecno Spark 20 Cases & Covers", 500],
  ["MJM-OU-TG-TECNO-SPARK-20C-001", "MJM Soft Transparent TPU Back Cover with 9H Tempered Glass Combo for Tecno Spark 20C", "Tecno Spark 20 Cases & Covers", 500],
  ["MJM-BROWN-A07-5G-FC-GLASS", "MJM Samsung Galaxy A07 5G Premium Brown Wallet Flip Cover with HD+ Tempered Glass Combo Pack", "Samsung A07 Cases & Covers", 0],
  ["MJM-OU-TG-TECNO-SPARK-20PRO-001", "MJM Soft Transparent TPU Back Cover with 9H Tempered Glass Combo for Tecno Spark 20 Pro", "Tecno Spark 20 Cases & Covers", 500],
  ["MJM-A07-BLK-FLIP-WALLET", "MJM Samsung Galaxy A07 5G Premium Black Leather Flip Cover Wallet Case with Card Slots", "Samsung A07 Cases & Covers", 500],
  ["MJM-3IN1-CABLE-120W-1M-ORANGE", "MJM 3 In 1 Orange Fast Charging Cable 120W Super Charge USB Cable with Type C, Micro USB & 8 Pin Connector 1 Meter", "Cables", 2],
  ["MJM-A07FC-GLASS-BRN-001", "MJM Samsung Galaxy A07 5G Brown Leather Flip Cover with 1 HD+ Tempered Glass Combo", "Samsung A07 Cases & Covers", 0],
  ["MJM-A07BRN-FLP", "MJM Samsung Galaxy A07 5G Premium Brown Leather Flip Cover Wallet Case with Card Slots, Magnetic Lock & Kickstand", "Samsung A07 Cases & Covers", 0],
  ["MJM-CP18-BTB54", "MJM CP-18 360 Degree Rotatable Cycle & Motorcycle Mobile Phone Holder Handlebar Mount", "Classy Motorcycle Mobile Holders", 3],
  ["MJM-ST-M201-BLK", "MJM ST-M201 Metal Motorcycle Mobile Holder with 360 Degree Rotation Handlebar & Mirror Mount | Black", "Beautiful Motorcycle Mobile Holders", 15],
  ["MJM-A07-5G-BLACK-FC-GLASS", "MJM Samsung Galaxy A07 5G Premium Black Wallet Flip Cover with HD+ Tempered Glass Combo Pack", "Samsung A07 Cases & Covers", 500],
  ["Blackcrystlepro", "MJM Crystal Pro Transparent TWS Wireless Earbuds with Digital LED Display, ENC Noise Reduction & Touch Control - Black", "Bluetooth Headphones & Earphones", 5],
  ["Whitetransperentairpod", "MJM Crystal Pro Transparent TWS Wireless Earbuds with Digital LED Display, ENC Noise Reduction & Touch Control - White", "Bluetooth Headphones & Earphones", 14],
  ["Crystalpro-black", "MJM Crystal Pro Transparent TWS Wireless Earbuds with Digital LED Display, ENC Noise Reduction & Touch Control - Black", "Bluetooth Headphones & Earphones", 8],
  ["Crystlepro-white", "MJM Crystal Pro Transparent TWS Wireless Earbuds with Digital LED Display, ENC Noise Reduction & Touch Control - White", "Bluetooth Headphones & Earphones", 14],
  ["MJM-OU-TG-SAMA16-002", "MJM Soft Transparent TPU Back Cover with 9H Tempered Glass Combo for Samsung Galaxy A16 5G (Pack of 2)", "Samsung Galaxy A16 5G Cases & Covers", 250],
  ["Spiral-4pc-multicolor", "MJM Spiral Cable Protector Set of 4 Pcs Flexible Silicone Wire Cord Saver for Fast Charging Cables", "Cable Connection Protectors", 1000],
  ["Spiral-12pc-multicolor", "MJM Spiral Cable Protector Set of 12 Pcs Flexible Silicone Wire Cord Saver for Fast Charging Cables", "Cable Connection Protectors", 1000],
  ["MJM-ST-M201-SILVER", "MJM ST-M201 Metal Motorcycle Mobile Holder with 360 Degree Rotation Handlebar & Mirror Mount | Silver", "Beautiful Motorcycle Mobile Holders", 20],
  ["10pcsoffwhite-ledleo", "MJM 10 Pcs 10W LED Bulb Combo Pack | Off White LED Light Bulbs | Energy Saving Long Lasting B22 Base Bulbs for Home Office Shop", "Classy Light Bulbs", 0],
  ["10pcs-cooldaylight-ledleo", "MJM 10 Pcs 10W LED Bulb Combo Pack | Cool Daylight White LED Light Bulbs | Energy Saving B22 Base Bulbs", "Classy Light Bulbs", 50],
  ["MJM-M100-MBLSTAND-BLK", "MJM M100 Foldable Mobile Phone Holder Stand for Desk, Tabletop Adjustable Smartphone Cradle - Black", "Classy Mobile Holders", 100],
  ["MJM-360-RBLMB-HLDR-BLK", "MJM 360 Degree Rotatable Foldable Desktop Mobile Holder Stand with Heavy Metal Base - Black", "Unique Mobile Holders", 100],
  ["MJM-360-RBLMB-HLDR-WHT", "MJM 360 Degree Rotatable Foldable Desktop Mobile Holder Stand with Heavy Metal Base - White", "Unique Mobile Holders", 100],
  ["MJM-M47-TWS-BLK", "MJM M47 TWS Earbuds Bluetooth Wireless Gaming Earphones with Heavy Bass, HD Mic & LED Display - Black", "Bluetooth Headphones & Earphones", 25],
  ["MJM-TG01-TWS-BLK", "MJM TG01 Gaming TWS Earbuds Bluetooth Wireless Headphones with Low Latency, RGB Breathing Light - Black", "Bluetooth Headphones & Earphones", 30],
  ["MJM-CRAZY-JUMPING-CAR-RED", "MJM Rechargeable Crazy Jumping Remote Control Stunt Car Toy with 360 Spinning Action, Lights & Music - Red", "Attractive Kids Musical Toys", 15],
  ["MJM-CRAZY-JUMPING-CAR-BLU", "MJM Rechargeable Crazy Jumping Remote Control Stunt Car Toy with 360 Spinning Action, Lights & Music - Blue", "Attractive Kids Musical Toys", 15],
  ["magicbookslate", "MJM Magic Practice Copybook Set of 4 with Sank Magic Pen for Kids Handwriting & Learning", "Styles Kids Reading & Writing Toys", 10],
  ["MJM-ASTRONAUT-GALAXY-PROJECTOR", "MJM Astronaut Galaxy Star Projector 360 Rotatable Night Light with Nebula Stars, Timer & Remote Control", "Royal Night Lights", 20],
  ["MJM-CLFAN", "MJM Cool Fan - Portable Smart Table Fan", "Fabulous Table Fans", 0],
  ["MJM-TG113-SPEAKER-BLK", "MJM TG113 Portable Bluetooth Wireless Speaker with Deep Bass, FM Radio, USB, TF Card Support - Black", "Bluetooth Speakers", 20]
];

const headers = [
  'SKU ID',
  'Product Name',
  'Category',
  'Current Stock (Meesho)',
  'Product Cost (Purchase Price Rs)',
  'Packaging Cost (Box/Polybag Rs)',
  'Influencer / Ads Cost (Rs)'
];

const sheetData = [headers];

rawData.forEach(item => {
  sheetData.push([
    item[0],
    item[1],
    item[2],
    item[3],
    '',
    '',
    0
  ]);
});

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(sheetData);

ws['!cols'] = [
  { wch: 32 },
  { wch: 50 },
  { wch: 30 },
  { wch: 22 },
  { wch: 30 },
  { wch: 30 },
  { wch: 25 }
];

XLSX.utils.book_append_sheet(wb, ws, 'SKU_Master_Costing');
XLSX.writeFile(wb, 'MJM_SKU_Costing_Master.xlsx');
console.log('✅ File "MJM_SKU_Costing_Master.xlsx" successfully create ho gayi aapke folder me!');