import { Button, Card } from '@heroui/react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="max-w-sm text-center">
        <Card.Header>
          <Card.Title>页面不存在</Card.Title>
          <Card.Description>你访问的地址没有对应页面。</Card.Description>
        </Card.Header>
        <Card.Footer>
          <Link to="/admin">
            <Button variant="primary" size="sm">返回控制台</Button>
          </Link>
        </Card.Footer>
      </Card>
    </div>
  );
}
