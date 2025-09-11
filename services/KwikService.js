import axios from 'axios';

const kwikApi = axios.create({
  baseURL: process.env.KWIK_BASE_URL,
  headers: {
    'Authorization': `Bearer ${process.env.KWIK_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

export const validateLagosAddress = (address) => {
  if (!address || !address.toLowerCase().includes('lagos')) {
    throw new Error('Kwik only supports Lagos deliveries. Address must contain "Lagos".');
  }
};

export const calculateKwikFee = async (pickup, delivery, weight) => {
  try {
    validateLagosAddress(pickup);
    validateLagosAddress(delivery);
    
    const response = await kwikApi.post('/orders/estimate', {
      pickup_address: pickup,
      delivery_address: delivery,
      package_details: { 
        weight: parseFloat(weight) || 1,
        description: 'E-commerce Package'
      }
    });
    
    return response.data.delivery_fee;
  } catch (error) {
    console.error('Kwik Fee Calculation Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw new Error(`Fee calculation failed: ${error.response?.data?.message || error.message}`);
  }
};

export const createKwikOrder = async (orderData) => {
  try {
    validateLagosAddress(orderData.pickup_address);
    validateLagosAddress(orderData.delivery_address);

    const payload = {
      pickup_address: orderData.pickup_address,
      delivery_address: orderData.delivery_address,
      package_details: {
        weight: orderData.weight || 1,
        description: 'E-commerce Package'
      },
      customer_reference: orderData.orderId,
      payment_method: 'vendor',
      recipient: {
        name: orderData.recipient_name,
        phone: orderData.recipient_phone
      }
    };
    
    console.log('Creating Kwik order with payload:', payload);
    const response = await kwikApi.post('/orders', payload);
    console.log('Kwik order created:', response.data);
    return response.data;
  } catch (error) {
    console.error('Kwik Create Order Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw new Error(`Kwik API Error: ${error.response?.data?.message || error.message}`);
  }
};

export const trackKwikOrder = async (kwikOrderId) => {
  try {
    console.log('Tracking Kwik order:', kwikOrderId);
    const response = await kwikApi.get(`/orders/${kwikOrderId}`);
    return response.data;
  } catch (error) {
    console.error('Kwik Tracking Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw new Error(`Tracking failed: ${error.response?.data?.message || error.message}`);
  }
};

export const handleKwikWebhook = (data) => {
  const statusMap = {
    'rider_assigned': 'accepted',
    'pickup_completed': 'picked_up',
    'in_transit': 'in_transit',
    'delivery_completed': 'delivered',
    'cancelled': 'cancelled'
  };
  
  return statusMap[data.event] || null;
};