import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { AppShell } from './components/AppShell.js';
import { Boot } from './components/Boot.js';
import { ToastStack } from './components/Toast.js';
import { LoginPage } from './features/auth/LoginPage.js';
import { RegisterPage } from './features/auth/RegisterPage.js';
import { CartDrawer } from './features/cart/CartDrawer.js';
import { CheckoutPage } from './pages/Checkout.js';
import { HomePage } from './pages/Home.js';
import { MyOrdersPage } from './pages/MyOrders.js';
import { OrderSuccessPage } from './pages/OrderSuccess.js';
import { ProductDetailPage } from './pages/ProductDetail.js';
import { ProductListPage } from './pages/ProductList.js';

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Boot>
        <Routes>
          {/* Storefront — shares the AppShell (nav + footer) */}
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/products" element={<ProductListPage />} />
            <Route path="/product/:slug" element={<ProductDetailPage />} />
            <Route path="/checkout" element={<CheckoutPage />} />
            <Route path="/orders/success/:orderId" element={<OrderSuccessPage />} />
            <Route path="/orders" element={<MyOrdersPage />} />
          </Route>
          {/* Auth pages stand alone — full-bleed form layout */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Routes>
        {/* Mounted once at the root so any route can open the drawer / toast. */}
        <CartDrawer />
        <ToastStack />
      </Boot>
    </BrowserRouter>
  );
}
