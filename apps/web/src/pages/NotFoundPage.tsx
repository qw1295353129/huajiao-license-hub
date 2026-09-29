import { Button } from '@/components/animate-ui/components/buttons/button';
import { Card, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="max-w-sm text-center">
        <CardHeader>
          <CardTitle>页面不存在</CardTitle>
          <CardDescription>你访问的地址没有对应页面。</CardDescription>
        </CardHeader>
        <CardFooter>
          <Link to="/admin">
            <Button variant="default" size="sm" className="bg-primary text-primary-foreground">返回控制台</Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}